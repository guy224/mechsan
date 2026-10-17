import { randomInt } from "node:crypto";
import { type DB, one, ensure } from "./db";
export type Activity = {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  waiting_at: Date;
  opens_at: Date;
  closes_at: Date;
  cancelled: boolean;
  paused: boolean;
  randomized: boolean;
};
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,details) VALUES($1,$2,$3)",
    [actor, action, JSON.stringify(details)],
  );
}
export async function unit(db: DB, userId: string) {
  const m = await one<{ unit_id: string }>(
    db,
    "SELECT unit_id FROM instructor_unit_members WHERE user_id=$1",
    [userId],
  );
  ensure(m, "לא נמצאה יחידת הדרכה");
  return m.unit_id;
}
export async function capacity(db: DB, activityId: string) {
  const inv = await one<{ total: number; damaged: number }>(
    db,
    "SELECT * FROM inventory_items WHERE id='mat'",
  );
  if (!inv) return 0;
  // Conservative: every outstanding loan from another activity blocks physical stock.
  const used = await one<{ n: string }>(
    db,
    `SELECT (SELECT count(*) FROM reservations WHERE activity_id=$1 AND status IN ('RESERVED','DISTRIBUTED'))+(SELECT count(*) FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id WHERE q.activity_id=$1 AND o.state='ACTIVE')+(SELECT count(*) FROM equipment_loans l JOIN reservations r ON r.id=l.reservation_id WHERE l.returned_at IS NULL AND r.activity_id<>$1)+(SELECT count(*) FROM reservations r JOIN activities a ON a.id=r.activity_id JOIN activities target ON target.id=$1 WHERE r.activity_id<>$1 AND r.status='RESERVED' AND a.starts_at<target.ends_at AND target.starts_at<a.ends_at)+(SELECT count(*) FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id JOIN activities a ON a.id=q.activity_id JOIN activities target ON target.id=$1 WHERE q.activity_id<>$1 AND o.state='ACTIVE' AND a.starts_at<target.ends_at AND target.starts_at<a.ends_at) AS n`,
    [activityId],
  );
  return Math.max(0, inv.total - inv.damaged - Number(used.n));
}
export async function tick(db: DB, now = new Date(), activityId?: string) {
  const expired = (
    await db.query<{ entry_id: string }>(
      "UPDATE queue_offers SET state='EXPIRED' WHERE state='ACTIVE' AND expires_at<=$1 RETURNING entry_id",
      [now],
    )
  ).rows;
  for (const o of expired)
    await db.query(
      "UPDATE queue_entries SET state='OFFER_EXPIRED' WHERE id=$1",
      [o.entry_id],
    );
  const activities = (
    await db.query<Activity>(
      "SELECT * FROM activities a WHERE ($2::uuid IS NULL OR a.id=$2) AND (a.closes_at>$1 AND NOT a.cancelled OR EXISTS(SELECT 1 FROM queue_entries q WHERE q.activity_id=a.id AND q.state IN ('WAITING_ROOM','QUEUED','WAITLISTED','OFFERED'))) ORDER BY opens_at,id",
      [now, activityId ?? null],
    )
  ).rows;
  for (const a of activities) {
    if (a.cancelled || +new Date(a.closes_at) <= +now) {
      await db.query(
        "UPDATE queue_offers SET state='CANCELLED' WHERE state='ACTIVE' AND entry_id IN (SELECT id FROM queue_entries WHERE activity_id=$1)",
        [a.id],
      );
      await db.query(
        "UPDATE queue_entries SET state='CLOSED' WHERE activity_id=$1 AND state IN ('WAITING_ROOM','QUEUED','WAITLISTED','OFFERED')",
        [a.id],
      );
      continue;
    }
    if (+new Date(a.opens_at) > +now) continue;
    if (!a.randomized) {
      const entries = (
        await db.query<{ id: string }>(
          "SELECT id FROM queue_entries WHERE activity_id=$1 AND state='WAITING_ROOM' ORDER BY joined_at,id",
          [a.id],
        )
      ).rows;
      for (let i = entries.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [entries[i], entries[j]] = [entries[j], entries[i]];
      }
      if (entries.length)
        await db.query(
          "UPDATE queue_entries q SET position=x.position,state='QUEUED' FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,position) WHERE q.id=x.id",
          [entries.map((e) => e.id)],
        );
      await db.query("UPDATE activities SET randomized=true WHERE id=$1", [
        a.id,
      ]);
    }
    if (a.paused) continue;
    let available = await capacity(db, a.id);
    const queue = (
      await db.query<{ id: string }>(
        "SELECT id FROM queue_entries WHERE activity_id=$1 AND state IN ('QUEUED','WAITLISTED') ORDER BY position LIMIT $2",
        [a.id, available],
      )
    ).rows;
    for (const entry of queue) {
      if (available > 0 && +new Date(a.closes_at) - +now >= 90000) {
        await db.query(
          "INSERT INTO queue_offers(entry_id,expires_at,state) VALUES($1,$2,'ACTIVE')",
          [entry.id, new Date(+now + 90000)],
        );
        await db.query("UPDATE queue_entries SET state='OFFERED' WHERE id=$1", [
          entry.id,
        ]);
        available--;
      }
    }
    await db.query(
      "UPDATE queue_entries SET state='WAITLISTED' WHERE activity_id=$1 AND state='QUEUED'",
      [a.id],
    );
  }
}
export async function join(
  db: DB,
  userId: string,
  activityId: string,
  now = new Date(),
) {
  const a = await one<Activity>(db, "SELECT * FROM activities WHERE id=$1", [
    activityId,
  ]);
  ensure(
    a &&
      !a.cancelled &&
      +new Date(a.waiting_at) <= +now &&
      +now < +new Date(a.closes_at),
    "חדר ההמתנה סגור",
  );
  if (!a.randomized && +new Date(a.opens_at) <= +now) {
    await tick(db, now, a.id);
    a.randomized = true;
  }
  ensure(
    await one(db, "SELECT id FROM inventory_items WHERE id='mat'"),
    "המלאי טרם הוגדר",
  );
  const uid = await unit(db, userId);
  const position = a.randomized
    ? Number(
        (
          await one<{ n: number }>(
            db,
            "SELECT coalesce(max(position),0)+1 n FROM queue_entries WHERE activity_id=$1",
            [a.id],
          )
        ).n,
      )
    : null;
  await db.query(
    "INSERT INTO queue_entries(activity_id,unit_id,state,position) VALUES($1,$2,$3,$4) ON CONFLICT(activity_id,unit_id) DO NOTHING",
    [a.id, uid, a.randomized ? "QUEUED" : "WAITING_ROOM", position],
  );
}
export async function confirm(
  db: DB,
  userId: string,
  activityId: string,
  now = new Date(),
) {
  const uid = await unit(db, userId);
  const prior = await one<{ id: string }>(
    db,
    "SELECT id FROM reservations WHERE activity_id=$1 AND unit_id=$2",
    [activityId, uid],
  );
  if (prior) return prior;
  const offer = await one<{ id: string; entry_id: string; expires_at: Date }>(
    db,
    "SELECT o.* FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id JOIN activities a ON a.id=q.activity_id WHERE q.activity_id=$1 AND q.unit_id=$2 AND o.state='ACTIVE' AND NOT a.cancelled AND a.closes_at>$3",
    [activityId, uid, now],
  );
  ensure(
    offer && +new Date(offer.expires_at) > +now,
    "ההצעה פגה או אינה זמינה",
  );
  await db.query("UPDATE queue_offers SET state='CONFIRMED' WHERE id=$1", [
    offer.id,
  ]);
  await db.query("UPDATE queue_entries SET state='RESERVED' WHERE id=$1", [
    offer.entry_id,
  ]);
  const r = await one<{ id: string }>(
    db,
    "INSERT INTO reservations(activity_id,unit_id,status,created_by) VALUES($1,$2,'RESERVED',$3) RETURNING id",
    [activityId, uid, userId],
  );
  await audit(db, userId, "RESERVE", r);
  return r;
}
export async function cancel(db: DB, userId: string, id: string) {
  const uid = await unit(db, userId);
  const r = await one<{ status: string }>(
    db,
    "SELECT status FROM reservations WHERE id=$1 AND unit_id=$2",
    [id, uid],
  );
  ensure(r, "ההזמנה לא נמצאה", 404);
  if (r.status === "CANCELLED") return;
  ensure(r.status === "RESERVED", "לא ניתן לבטל מחצלת שכבר נמסרה");
  await db.query("UPDATE reservations SET status='CANCELLED' WHERE id=$1", [
    id,
  ]);
  await audit(db, userId, "CANCEL", { id });
  await tick(db);
}
