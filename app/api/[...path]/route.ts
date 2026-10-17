import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { database, transaction, one, ensure, AppError } from "@/lib/db";
import { currentUser, limit, staff, admin } from "@/lib/auth";
import {
  register,
  partnership,
  warehouse,
  manual,
  administer,
} from "@/lib/operations";
import {
  join,
  confirm,
  cancel,
  unit,
  tick,
  capacity,
  audit,
} from "@/lib/queue";
import { uuid } from "@/lib/validation";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function readBody(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader();
  ensure(reader, "בקשה ריקה");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 16384) {
      await reader.cancel();
      throw new AppError("הבקשה גדולה מדי", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("מבנה הבקשה אינו תקין");
  }
}
async function handle(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname.slice(5);
    const db = database();
    if (req.method === "POST") {
      ensure(
        req.headers.get("origin") ===
          new URL(process.env.NEXTAUTH_URL ?? req.url).origin,
        "מקור הבקשה אינו מורשה",
        403,
      );
      ensure(
        (Number(req.headers.get("content-length")) || 0) < 16384,
        "הבקשה גדולה מדי",
      );
    }
    if (path === "teams" && req.method === "GET")
      return json(
        (
          await db.query(
            "SELECT id,name FROM scout_teams WHERE active ORDER BY name",
          )
        ).rows,
      );
    if (path === "register" && req.method === "POST") {
      await limit(db, "registration-global", 30);
      const body = await readBody(req);
      await transaction((c) => register(c, body));
      return json({ ok: true });
    }
    const u = await currentUser();
    if (req.method === "GET") {
      if (path === "state") {
        const uid = await unit(db, u.id);
        const [
          activities,
          reservations,
          members,
          requests,
          announcement,
          jobs,
        ] = await Promise.all([
          db.query(
          `SELECT a.*,q.state queue_state,q.position,o.expires_at,(SELECT count(*) FROM queue_entries ahead WHERE ahead.activity_id=a.id AND ahead.position<q.position AND ahead.state IN ('QUEUED','WAITLISTED','OFFERED')) ahead FROM activities a LEFT JOIN queue_entries q ON q.activity_id=a.id AND q.unit_id=$1 LEFT JOIN queue_offers o ON o.entry_id=q.id AND o.state='ACTIVE' WHERE NOT a.cancelled AND a.ends_at>now()-interval '1 day' ORDER BY a.starts_at LIMIT 12`,
            [uid],
          ),
          db.query(
            `SELECT r.id,r.activity_id,r.unit_id,r.status,r.qr_token,r.names,r.team_name,a.title,a.starts_at,a.ends_at FROM reservations r JOIN activities a ON a.id=r.activity_id WHERE r.unit_id=$1 OR $2=ANY(r.borrower_ids) ORDER BY a.starts_at DESC LIMIT 50`,
            [uid, u.id],
          ),
          db.query(
            "SELECT u.id,u.name FROM users u JOIN instructor_unit_members m ON m.user_id=u.id WHERE m.unit_id=$1",
            [uid],
          ),
          db.query(
            "SELECT p.id,u.name FROM partnership_requests p JOIN users u ON u.id=p.sender_id WHERE recipient_id=$1 AND status='PENDING'",
            [u.id],
          ),
          one<{ value: string }>(
            db,
            "SELECT value FROM application_settings WHERE key='announcement'",
          ),
          db.query("SELECT id,last_success FROM background_jobs"),
        ]);
        const enriched = await Promise.all(
          activities.rows.map(async (a) => ({
            ...a,
            available: await capacity(db, a.id as string),
          })),
        );
        return json({
          user: { id: u.id, name: u.name, role: u.role, team_id: u.team_id },
          activities: enriched,
          reservations: reservations.rows,
          members: members.rows,
          requests: requests.rows,
          announcement: announcement?.value ?? "",
          jobs: jobs.rows,
          serverTime: new Date().toISOString(),
          configured: !!(await one(
            db,
            "SELECT id FROM inventory_items WHERE id='mat'",
          )),
        });
      }
      if (path === "partners") {
        await limit(db, "partner-search:" + u.id, 30);
        const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
        ensure(q.length >= 3, "יש להזין לפחות שלוש אותיות");
        return json(
          (
            await db.query(
              "SELECT id,name FROM users WHERE team_id=$1 AND id<>$2 AND NOT disabled AND name ILIKE $3 ORDER BY name LIMIT 5",
              [u.team_id, u.id, `%${q}%`],
            )
          ).rows,
        );
      }
      if (path === "warehouse") {
        staff(u);
        const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
        const token = req.nextUrl.searchParams.get("token");
        if (token) uuid.parse(token);
        const rows = (
          await db.query(
            `SELECT r.*,a.title,a.starts_at FROM reservations r JOIN activities a ON a.id=r.activity_id WHERE ($1::uuid IS NULL OR r.qr_token=$1) AND ($2='' OR r.names ILIKE $3 OR r.borrower_phones ILIKE $3 OR r.team_name ILIKE $3) ORDER BY a.starts_at DESC LIMIT 100`,
            [token ?? null, q, `%${q}%`],
          )
        ).rows;
        const inventory = await one(
          db,
          "SELECT *,total-damaged-(SELECT count(*) FROM equipment_loans WHERE returned_at IS NULL) physical_available FROM inventory_items WHERE id='mat'",
        );
        return json({ rows, inventory });
      }
      if (path === "people") {
        staff(u);
        const q = req.nextUrl.searchParams.get("q") ?? "";
        ensure(q.length >= 3, "יש להזין לפחות שלושה תווים");
        return json(
          (
            await db.query(
              "SELECT id,name,phone FROM users WHERE name ILIKE $1 OR phone ILIKE $1 LIMIT 15",
              [`%${q}%`],
            )
          ).rows,
        );
      }
      if (path === "admin") {
        admin(u);
        const [users, teams, schedules, audits, queue, requests] =
          await Promise.all([
            db.query(
              "SELECT id,name,phone,role,disabled,team_id FROM users ORDER BY name",
            ),
            db.query("SELECT * FROM scout_teams ORDER BY name"),
            db.query("SELECT * FROM weekly_schedules"),
            db.query(
              "SELECT a.*,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100",
            ),
            db.query(
              "SELECT q.*,a.title,o.expires_at FROM queue_entries q JOIN activities a ON a.id=q.activity_id LEFT JOIN queue_offers o ON o.entry_id=q.id WHERE a.ends_at>now() ORDER BY a.starts_at,q.position",
            ),
            db.query(
              "SELECT p.*,s.name sender,r.name recipient FROM partnership_requests p JOIN users s ON s.id=p.sender_id JOIN users r ON r.id=p.recipient_id WHERE p.status='PENDING'",
            ),
          ]);
        return json({
          users: users.rows,
          teams: teams.rows,
          schedules: schedules.rows,
          audits: audits.rows,
          queue: queue.rows,
          requests: requests.rows,
        });
      }
      throw new AppError("לא נמצא", 404);
    }
    ensure(req.method === "POST", "פעולה לא נתמכת", 405);
    await limit(db, "mutation:" + u.id, 120);
    const body = z.record(z.string(), z.unknown()).parse(await readBody(req));
    await transaction(async (c) => {
      const fresh = await one<{ disabled: boolean; session_version: number }>(
        c,
        "SELECT disabled,session_version FROM users WHERE id=$1",
        [u.id],
      );
      ensure(
        fresh && !fresh.disabled && fresh.session_version === u.session_version,
        "יש להתחבר מחדש",
        401,
      );
      switch (path) {
        case "join":
          await join(c, u.id, uuid.parse(body.activityId));
          break;
        case "confirm":
          await confirm(c, u.id, uuid.parse(body.activityId));
          break;
        case "cancel":
          await cancel(c, u.id, uuid.parse(body.id));
          break;
        case "decline": {
          const uid = await unit(c, u.id);
          await c.query(
            "UPDATE queue_offers SET state='DECLINED' WHERE state='ACTIVE' AND entry_id IN (SELECT id FROM queue_entries WHERE activity_id=$1 AND unit_id=$2)",
            [uuid.parse(body.activityId), uid],
          );
          await c.query(
            "UPDATE queue_entries SET state='OFFER_EXPIRED' WHERE activity_id=$1 AND unit_id=$2 AND state='OFFERED'",
            [body.activityId, uid],
          );
          await tick(c);
          break;
        }
        case "partnership": {
          const s = z
            .object({
              action: z.enum(["request", "accept", "reject", "dissolve"]),
              target: z.uuid(),
              override: z.boolean().default(false),
            })
            .parse(body);
          await partnership(c, u, s.action, s.target, s.override);
          break;
        }
        case "warehouse": {
          const s = z
            .object({ token: z.uuid(), action: z.enum(["pickup", "return"]) })
            .parse(body);
          await warehouse(c, u, s.token, s.action);
          break;
        }
        case "manual": {
          const s = z
            .object({
              userId: z.uuid(),
              activityId: z.uuid(),
              reason: z.string().min(8).max(500),
            })
            .parse(body);
          await manual(c, u, s.userId, s.activityId, s.reason);
          break;
        }
        case "admin":
          await administer(c, u, body);
          break;
        case "profile": {
          const s = z
            .object({
              name: z.string().trim().min(2).max(80),
              teamId: z.uuid(),
            })
            .parse(body);
          if (s.teamId !== u.team_id) {
            const uid = await unit(c, u.id);
            ensure(
              Number(
                (
                  await one<{ n: string }>(
                    c,
                    "SELECT count(*) n FROM instructor_unit_members WHERE unit_id=$1",
                    [uid],
                  )
                ).n,
              ) === 1,
              "יש לבקש ממנהל לשנות קבוצה לשותפות",
            );
            ensure(
              !(await one(
                c,
                "SELECT id FROM reservations WHERE unit_id=$1 AND status IN ('RESERVED','DISTRIBUTED') UNION ALL SELECT q.id FROM queue_entries q JOIN activities a ON a.id=q.activity_id WHERE q.unit_id=$1 AND a.closes_at>now() LIMIT 1",
                [uid],
              )),
              "לא ניתן לשנות קבוצה בזמן תור או השאלה",
            );
          }
          ensure(
            await one(c, "SELECT id FROM scout_teams WHERE id=$1 AND active", [
              s.teamId,
            ]),
            "הקבוצה אינה פעילה",
          );
          await c.query("UPDATE users SET name=$2,team_id=$3 WHERE id=$1", [
            u.id,
            s.name,
            s.teamId,
          ]);
          await audit(c, u.id, "PROFILE");
          break;
        }
        default:
          throw new AppError("לא נמצא", 404);
      }
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json({ error: "יש לבדוק את הפרטים שהוזנו" }, 400);
    if ((e as { code?: string }).code === "23505")
      return json({ error: "הפעולה כבר בוצעה או שהפרטים כבר בשימוש" }, 409);
    console.error(e instanceof Error ? e.message : "Request failed");
    return json(
      {
        error: process.env.DATABASE_URL
          ? "לא ניתן להשלים את הפעולה. נסו שוב"
          : "המערכת ממתינה לחיבור מסד הנתונים",
      },
      503,
    );
  }
}
export { handle as GET, handle as POST };
