import argon2 from "argon2";
import { z } from "zod";
import { type DB, one, ensure } from "./db";
import { type User, staff, admin } from "./auth";
import { audit, unit, tick, capacity } from "./queue";
import { signup, password } from "./validation";
export async function register(db: DB, input: unknown) {
  const s = signup.parse(input);
  ensure(
    await one(db, "SELECT id FROM machsan.scout_teams WHERE id=$1 AND active", [
      s.teamId,
    ]),
    "יש לבחור קבוצה פעילה",
  );
  ensure(
    !(await one(db, "SELECT id FROM machsan.users WHERE phone=$1", [s.phone])),
    "לא ניתן להשלים הרשמה עם הפרטים האלה",
  );
  const hash = await argon2.hash(s.password, { type: argon2.argon2id });
  const u = await one<{ id: string }>(
    db,
    "INSERT INTO machsan.users(name,phone,password_hash,team_id) VALUES($1,$2,$3,$4) RETURNING id",
    [s.name, s.phone, hash, s.teamId],
  );
  const g = await one<{ id: string }>(
    db,
    "INSERT INTO machsan.instructor_units DEFAULT VALUES RETURNING id",
  );
  await db.query("INSERT INTO machsan.instructor_unit_members VALUES($1,$2)", [
    u.id,
    g.id,
  ]);
  await audit(db, u.id, "REGISTER", { partnered: s.partnered });
  return u;
}
async function movable(db: DB, id: string) {
  ensure(
    !(await one(
      db,
      `SELECT id FROM machsan.reservations WHERE unit_id=$1 AND status IN ('RESERVED','DISTRIBUTED') UNION ALL SELECT q.id FROM machsan.queue_entries q JOIN machsan.activities a ON a.id=q.activity_id WHERE q.unit_id=$1 AND a.closes_at>now() AND NOT a.cancelled LIMIT 1`,
      [id],
    )),
    "אפשר לשנות שותפות רק לאחר סיום התור והחזרת כל הציוד",
  );
}
export async function partnership(
  db: DB,
  u: User,
  action: string,
  target: string,
  override = false,
) {
  if (override) admin(u);
  if (action === "request") {
    const other = await one<User>(
      db,
      "SELECT * FROM machsan.users WHERE id=$1 AND NOT disabled",
      [target],
    );
    ensure(
      other && other.id !== u.id && other.team_id === u.team_id,
      "ניתן לשלוח בקשה למדריך מהקבוצה שלך",
    );
    for (const id of [u.id, other.id])
      ensure(
        Number(
          (
            await one<{ n: string }>(
              db,
              "SELECT count(*) n FROM machsan.instructor_unit_members WHERE unit_id=(SELECT unit_id FROM machsan.instructor_unit_members WHERE user_id=$1)",
              [id],
            )
          ).n,
        ) === 1,
        "אחד המדריכים כבר בשותפות",
      );
    await db.query(
      "INSERT INTO machsan.partnership_requests(sender_id,recipient_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [u.id, target],
    );
    return;
  }
  if (action === "dissolve") {
    admin(u);
    const old = await unit(db, target);
    await movable(db, old);
    const members = (
      await db.query<{ user_id: string }>(
        "SELECT user_id FROM machsan.instructor_unit_members WHERE unit_id=$1",
        [old],
      )
    ).rows;
    for (const m of members) {
      const fresh = await one<{ id: string }>(
        db,
        "INSERT INTO machsan.instructor_units DEFAULT VALUES RETURNING id",
      );
      await db.query(
        "UPDATE machsan.instructor_unit_members SET unit_id=$1 WHERE user_id=$2",
        [fresh.id, m.user_id],
      );
    }
    await audit(db, u.id, "DISSOLVE", { unit: old });
    return;
  }
  const r = await one<{
    sender_id: string;
    recipient_id: string;
    status: string;
  }>(db, "SELECT * FROM machsan.partnership_requests WHERE id=$1", [target]);
  ensure(
    r && (r.recipient_id === u.id || override) && r.status === "PENDING",
    "הבקשה אינה זמינה",
  );
  if (action === "reject") {
    await db.query(
      "UPDATE machsan.partnership_requests SET status='REJECTED' WHERE id=$1",
      [target],
    );
    return;
  }
  const people = (
    await db.query<User>(
      "SELECT * FROM machsan.users WHERE id=ANY($1::uuid[])",
      [[r.sender_id, r.recipient_id]],
    )
  ).rows;
  ensure(
    people.length === 2 &&
      !people.some((p) => p.disabled) &&
      (override || people[0].team_id === people[1].team_id),
    "הקבוצות אינן תואמות",
  );
  for (const id of [r.sender_id, r.recipient_id]) {
    const old = await unit(db, id);
    await movable(db, old);
    ensure(
      Number(
        (
          await one<{ n: string }>(
            db,
            "SELECT count(*) n FROM machsan.instructor_unit_members WHERE unit_id=$1",
            [old],
          )
        ).n,
      ) === 1,
      "כבר קיימת שותפות",
    );
  }
  const fresh = await one<{ id: string }>(
    db,
    "INSERT INTO machsan.instructor_units DEFAULT VALUES RETURNING id",
  );
  await db.query(
    "UPDATE machsan.instructor_unit_members SET unit_id=$1 WHERE user_id=ANY($2::uuid[])",
    [fresh.id, [r.sender_id, r.recipient_id]],
  );
  await db.query(
    "UPDATE machsan.partnership_requests SET status=CASE WHEN id=$1 THEN 'ACCEPTED' ELSE 'REJECTED' END WHERE status='PENDING' AND (sender_id=ANY($2::uuid[]) OR recipient_id=ANY($2::uuid[]))",
    [target, [r.sender_id, r.recipient_id]],
  );
  await audit(db, u.id, "PARTNERSHIP", { request: target, override });
}
export async function warehouse(
  db: DB,
  u: User,
  token: string,
  action: "pickup" | "return",
) {
  staff(u);
  const r = await one<{
    id: string;
    status: string;
    activity_id: string;
    starts_at: Date;
    ends_at: Date;
    cancelled: boolean;
  }>(
    db,
    "SELECT r.*,a.starts_at,a.ends_at,a.cancelled FROM machsan.reservations r JOIN machsan.activities a ON a.id=r.activity_id WHERE qr_token=$1",
    [token],
  );
  ensure(r, "קוד לא מוכר", 404);
  if (action === "pickup") {
    if (r.status === "DISTRIBUTED") return;
    ensure(r.status === "RESERVED" && !r.cancelled, "ההזמנה אינה זמינה למסירה");
    const now = Date.now();
    ensure(
      now >= +new Date(r.starts_at) - 3600000 && now <= +new Date(r.ends_at),
      "המסירה אפשרית משעה לפני הפעילות ועד סיומה",
    );
    const inv = await one<{ n: number }>(
      db,
      "SELECT total-damaged-(SELECT count(*) FROM machsan.equipment_loans WHERE returned_at IS NULL) n FROM machsan.inventory_items WHERE id='mat'",
    );
    ensure(inv && inv.n > 0, "אין מחצלות זמינות פיזית");
    await db.query(
      "UPDATE machsan.reservations SET status='DISTRIBUTED' WHERE id=$1",
      [r.id],
    );
    await db.query(
      "INSERT INTO machsan.equipment_loans(reservation_id,item_id,distributed_by) VALUES($1,'mat',$2)",
      [r.id, u.id],
    );
  } else {
    if (r.status === "RETURNED") return;
    ensure(r.status === "DISTRIBUTED", "לא נרשמה מסירה להזמנה זו");
    await db.query(
      "UPDATE machsan.equipment_loans SET returned_at=now(),returned_by=$2 WHERE reservation_id=$1 AND returned_at IS NULL",
      [r.id, u.id],
    );
    await db.query(
      "UPDATE machsan.reservations SET status='RETURNED' WHERE id=$1",
      [r.id],
    );
  }
  await db.query(
    "INSERT INTO machsan.inventory_transactions(reservation_id,actor_id,action) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [r.id, u.id, action],
  );
  await audit(db, u.id, action, { reservation: r.id });
  await tick(db);
}
export async function manual(
  db: DB,
  u: User,
  userId: string,
  activityId: string,
  reason: string,
) {
  staff(u);
  ensure(reason.trim().length >= 8, "יש לציין סיבה מפורטת לעקיפת התור");
  await tick(db);
  const a = await one(
    db,
    "SELECT id FROM machsan.activities WHERE id=$1 AND NOT cancelled AND ends_at>now()",
    [activityId],
  );
  ensure(a, "הפעילות אינה זמינה");
  ensure((await capacity(db, activityId)) > 0, "אין מלאי זמין");
  const uid = await unit(db, userId);
  ensure(
    !(await one(
      db,
      "SELECT q.id FROM machsan.queue_entries q JOIN machsan.queue_offers o ON o.entry_id=q.id WHERE q.activity_id=$1 AND q.unit_id=$2 AND o.state='ACTIVE'",
      [activityId, uid],
    )),
    "יש לאשר או לדחות תחילה את ההצעה הפעילה",
  );
  await db.query(
    "INSERT INTO machsan.reservations(activity_id,unit_id,status,created_by) VALUES($1,$2,'RESERVED',$3)",
    [activityId, uid, u.id],
  );
  await db.query(
    "UPDATE machsan.queue_entries SET state='RESERVED' WHERE activity_id=$1 AND unit_id=$2",
    [activityId, uid],
  );
  await audit(db, u.id, "MANUAL_RESERVATION", { userId, activityId, reason });
}
export async function administer(db: DB, u: User, input: unknown) {
  admin(u);
  const b = z
    .object({ action: z.string(), data: z.record(z.string(), z.unknown()) })
    .parse(input);
  const d = b.data;
  switch (b.action) {
    case "inventory": {
      const s = z
        .object({
          total: z.coerce.number().int().min(0).max(10000),
          damaged: z.coerce.number().int().min(0),
        })
        .parse(d);
      ensure(s.damaged <= s.total, "מלאי לא תקין");
      const old = await one<{ total: number; damaged: number }>(
        db,
        "SELECT * FROM machsan.inventory_items WHERE id='mat'",
      );
      if (old && s.total - s.damaged < old.total - old.damaged) {
        ensure(
          !(await one(
            db,
            "SELECT id FROM machsan.reservations WHERE status IN ('RESERVED','DISTRIBUTED') UNION ALL SELECT id FROM machsan.queue_offers WHERE state='ACTIVE' LIMIT 1",
          )),
          "יש לסיים הקצאות והשאלות לפני הקטנת המלאי",
        );
      }
      await db.query(
        "INSERT INTO machsan.inventory_items(id,name,total,damaged) VALUES('mat','מחצלות',$1,$2) ON CONFLICT(id) DO UPDATE SET total=$1,damaged=$2",
        [s.total, s.damaged],
      );
      break;
    }
    case "team": {
      const s = z
        .object({
          id: z.uuid().optional(),
          name: z.string().trim().min(2).max(60),
          active: z.boolean().default(true),
        })
        .parse(d);
      if (s.id)
        await db.query(
          "UPDATE machsan.scout_teams SET name=$2,active=$3 WHERE id=$1",
          [s.id, s.name, s.active],
        );
      else
        await db.query("INSERT INTO machsan.scout_teams(name) VALUES($1)", [
          s.name,
        ]);
      break;
    }
    case "user": {
      const s = z
        .object({
          id: z.uuid(),
          role: z.enum(["INSTRUCTOR", "STAFF", "ADMIN"]),
          disabled: z.boolean(),
          teamId: z.uuid().optional(),
        })
        .parse(d);
      ensure(s.id !== u.id, "לא ניתן לשנות הרשאות עצמיות");
      if (s.teamId) {
        const uid = await unit(db, s.id);
        await movable(db, uid);
        ensure(
          Number(
            (
              await one<{ n: string }>(
                db,
                "SELECT count(*) n FROM machsan.instructor_unit_members WHERE unit_id=$1",
                [uid],
              )
            ).n,
          ) === 1,
          "יש לפרק שותפות לפני שינוי קבוצה",
        );
        ensure(
          await one(
            db,
            "SELECT id FROM machsan.scout_teams WHERE id=$1 AND active",
            [s.teamId],
          ),
          "קבוצה לא פעילה",
        );
      }
      await db.query(
        "UPDATE machsan.users SET role=$2,disabled=$3,team_id=coalesce($4,team_id),session_version=session_version+1 WHERE id=$1",
        [s.id, s.role, s.disabled, s.teamId ?? null],
      );
      break;
    }
    case "recovery": {
      const s = z
        .object({
          id: z.uuid(),
          password,
          verification: z.string().trim().min(12),
        })
        .parse(d);
      await db.query(
        "UPDATE machsan.users SET password_hash=$2,session_version=session_version+1 WHERE id=$1",
        [s.id, await argon2.hash(s.password, { type: argon2.argon2id })],
      );
      await audit(db, u.id, "RECOVERY", {
        id: s.id,
        verification: s.verification,
      });
      return;
    }
    case "activity": {
      const s = z
        .object({
          id: z.uuid().optional(),
          title: z.string().min(2).max(100),
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
          opensAt: z.iso.datetime(),
          waitingAt: z.iso.datetime(),
          closesAt: z.iso.datetime(),
        })
        .parse(d);
      ensure(
        s.waitingAt <= s.opensAt &&
          s.opensAt < s.closesAt &&
          s.startsAt < s.endsAt,
        "זמנים לא תקינים",
      );
      if (s.id) {
        ensure(
          !(await one(
            db,
            "SELECT id FROM machsan.queue_entries WHERE activity_id=$1 LIMIT 1",
            [s.id],
          )),
          "פעילות עם משתתפים אינה ניתנת לתזמון מחדש",
        );
        await db.query(
          "UPDATE machsan.activities SET title=$2,starts_at=$3,ends_at=$4,opens_at=$5,waiting_at=$6,closes_at=$7 WHERE id=$1",
          [
            s.id,
            s.title,
            s.startsAt,
            s.endsAt,
            s.opensAt,
            s.waitingAt,
            s.closesAt,
          ],
        );
      } else
        await db.query(
          "INSERT INTO machsan.activities(title,starts_at,ends_at,opens_at,waiting_at,closes_at) VALUES($1,$2,$3,$4,$5,$6)",
          [s.title, s.startsAt, s.endsAt, s.opensAt, s.waitingAt, s.closesAt],
        );
      break;
    }
    case "queue": {
      const s = z
        .object({
          id: z.uuid(),
          operation: z.enum(["pause", "resume", "cancel", "open", "close"]),
        })
        .parse(d);
      if (s.operation === "pause" || s.operation === "resume")
        await db.query("UPDATE machsan.activities SET paused=$2 WHERE id=$1", [
          s.id,
          s.operation === "pause",
        ]);
      if (s.operation === "open")
        await db.query(
          "UPDATE machsan.activities SET opens_at=now(),waiting_at=least(waiting_at,now()) WHERE id=$1 AND closes_at>now()",
          [s.id],
        );
      if (s.operation === "close")
        await db.query(
          "UPDATE machsan.activities SET closes_at=greatest(now(),opens_at+interval '1 millisecond') WHERE id=$1",
          [s.id],
        );
      if (s.operation === "cancel") {
        await db.query(
          "UPDATE machsan.activities SET cancelled=true WHERE id=$1",
          [s.id],
        );
        await db.query(
          "UPDATE machsan.reservations SET status='CANCELLED' WHERE activity_id=$1 AND status='RESERVED'",
          [s.id],
        );
      }
      break;
    }
    case "schedule": {
      const s = z
        .object({
          id: z.uuid(),
          weekday: z.coerce.number().int().min(0).max(6),
          start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          opening: z.coerce.number().int().min(1).max(10080),
          waiting: z.coerce.number().int().min(0).max(1440),
          active: z.boolean(),
        })
        .parse(d);
      ensure(s.start < s.end, "שעת הסיום צריכה להיות אחרי ההתחלה");
      await db.query(
        "UPDATE machsan.weekly_schedules SET weekday=$2,start_time=$3,end_time=$4,opening_minutes=$5,waiting_minutes=$6,active=$7 WHERE id=$1",
        [s.id, s.weekday, s.start, s.end, s.opening, s.waiting, s.active],
      );
      break;
    }
    case "announcement": {
      const s = z.object({ text: z.string().max(500) }).parse(d);
      await db.query(
        "INSERT INTO machsan.application_settings VALUES('announcement',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
        [JSON.stringify(s.text)],
      );
      break;
    }
    default:
      ensure(false, "פעולה לא מוכרת");
  }
  await audit(db, u.id, b.action, d);
  await tick(db);
}
