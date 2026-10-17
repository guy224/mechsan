import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  join as rawJoin,
  confirm,
  tick,
  cancel,
  capacity,
  unit,
} from "../lib/queue";
import {
  register,
  partnership,
  warehouse,
  manual,
  administer,
} from "../lib/operations";
import { staff, admin, limit, type User } from "../lib/auth";
import { phone } from "../lib/validation";
import { activityTimes } from "../lib/schedule";
import { one, type DB } from "../lib/db";
let pg: PGlite;
let real: Pool | undefined;
let db: DB;
let team: string;
let actor: User;
const now = new Date();
let mutex: Promise<unknown> = Promise.resolve();
function tx<T>(fn: (c: DB) => Promise<T>): Promise<T> {
  if (real)
    return (async () => {
      const client = await real!.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT id FROM operation_lock WHERE id=1 FOR UPDATE",
        );
        const r = await fn(client);
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })();
  const task = mutex.then(async () => {
    await pg.exec("BEGIN");
    try {
      await pg.query("SELECT id FROM operation_lock WHERE id=1 FOR UPDATE");
      const r = await fn(db);
      await pg.exec("COMMIT");
      return r;
    } catch (e) {
      await pg.exec("ROLLBACK");
      throw e;
    }
  });
  mutex = task.catch(() => {});
  return task;
}
async function join(c: DB, userId: string, activityId: string, at: Date) {
  await rawJoin(c, userId, activityId, at);
  await tick(c, at, activityId);
}
async function person(name = "מדריך"): Promise<User> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,name,phone,password_hash,team_id) VALUES($1,$2,$3,'test',$4)",
    [id, name, id, team],
  );
  const uid = randomUUID();
  await db.query("INSERT INTO instructor_units(id) VALUES($1)", [uid]);
  await db.query("INSERT INTO instructor_unit_members VALUES($1,$2)", [
    id,
    uid,
  ]);
  return await one<User>(db, "SELECT * FROM users WHERE id=$1", [id]);
}
async function activity(offset = 0) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO activities(id,title,starts_at,ends_at,waiting_at,opens_at,closes_at) VALUES($1,'פעולה',$2,$3,$4,$5,$6)",
    [
      id,
      new Date(+now + 3600000 + offset),
      new Date(+now + 10800000 + offset),
      new Date(+now - 900000 + offset),
      new Date(+now + offset),
      new Date(+now + 3600000 + offset),
    ],
  );
  return id;
}
async function resetStock(total = 1) {
  await db.query(
    "UPDATE reservations SET status='RETURNED' WHERE status IN ('RESERVED','DISTRIBUTED')",
  );
  await db.query(
    "UPDATE equipment_loans SET returned_at=now() WHERE returned_at IS NULL",
  );
  await db.query(
    "UPDATE queue_offers SET state='CANCELLED' WHERE state='ACTIVE'",
  );
  await db.query("UPDATE activities SET cancelled=true");
  await db.query(
    "INSERT INTO inventory_items(id,name,total,damaged) VALUES('mat','מחצלות',$1,0) ON CONFLICT(id) DO UPDATE SET total=$1,damaged=0",
    [total],
  );
}
beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Native concurrency tests cannot run in production");
    if (process.env.ALLOW_DESTRUCTIVE_NATIVE_TESTS !== "YES")
      throw new Error(
        "Set ALLOW_DESTRUCTIVE_NATIVE_TESTS=YES for this test-only schema reset",
      );
    if (
      !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("/machsan_test")
    )
      throw new Error("Use a disposable database named machsan_test");
    real = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 20,
      options: "-c search_path=machsan,public",
    });
    await real.query("DROP SCHEMA IF EXISTS machsan CASCADE");
    await real.query(await readFile("db/001_initial.sql", "utf8"));
    db = real;
  } else {
    pg = new PGlite();
    await pg.exec(await readFile("db/001_initial.sql", "utf8"));
    db = {
      query: async <T>(sql: string, values?: unknown[]) => {
        const r = await pg.query<T>(sql, values);
        return { rows: r.rows, rowCount: r.affectedRows };
      },
    };
  }
  team = (
    await one<{ id: string }>(
      db,
      "INSERT INTO scout_teams(name) VALUES('אורנים') RETURNING id",
    )
  ).id;
  actor = await person("מנהל");
  actor.role = "ADMIN";
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [actor.id]);
}, 30000);
afterAll(async () => {
  if (real) await real.end();
  else await pg.close();
});
describe("identity and access", () => {
  it("normalizes Israeli numbers and rejects invalid input", () => {
    expect(phone("+972 50-123-4567")).toBe("0501234567");
    expect(() => phone("123")).toThrow();
  });
  it("registers a unique phone with Argon2id, an individual unit and instructor role", async () => {
    const r = await tx((c) =>
      register(c, {
        name: "מדריכה חדשה",
        phone: "0501234567",
        password: "long-secret-passphrase",
        teamId: team,
      }),
    );
    const u = await one<User>(db, "SELECT * FROM users WHERE id=$1", [r.id]);
    expect(u.role).toBe("INSTRUCTOR");
    expect(u.password_hash).toContain("$argon2id$");
    expect(await unit(db, r.id)).toBeTruthy();
    await expect(
      tx((c) =>
        register(c, {
          name: "מדריכה",
          phone: "+972501234567",
          password: "long-secret-passphrase",
          teamId: team,
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejects public privilege assignment and unauthorized roles", async () => {
    const r = await tx((c) =>
      register(c, {
        name: "מדריך רגיל",
        phone: "0521234567",
        password: "long-secret-passphrase",
        teamId: team,
        role: "ADMIN",
      }),
    );
    const u = await one<User>(db, "SELECT * FROM users WHERE id=$1", [r.id]);
    expect(u.role).toBe("INSTRUCTOR");
    expect(() => staff(u)).toThrow();
    expect(() => admin({ ...u, role: "STAFF" })).toThrow();
    await expect(
      tx((c) =>
        administer(c, u, {
          action: "inventory",
          data: { total: 999, damaged: 0 },
        }),
      ),
    ).rejects.toThrow();
  });
  it("persists rate limits across attempts", async () => {
    await limit(db, "test-limit", 1);
    await expect(limit(db, "test-limit", 1)).rejects.toThrow();
  });
  it("accepts partnerships once and creates a shared identity", async () => {
    const a = await person(),
      b = await person();
    await tx((c) => partnership(c, a, "request", b.id));
    const r = await one<{ id: string }>(
      db,
      "SELECT id FROM partnership_requests WHERE sender_id=$1",
      [a.id],
    );
    await tx((c) => partnership(c, b, "accept", r.id));
    expect(await unit(db, a.id)).toBe(await unit(db, b.id));
    await expect(
      tx((c) => partnership(c, b, "accept", r.id)),
    ).rejects.toThrow();
    await expect(
      tx((c) => partnership(c, a, "request", actor.id)),
    ).rejects.toThrow();
  });
});
describe("persistent queue and inventory", () => {
  it("keeps reservations disabled before initial inventory configuration", async () => {
    const a = await activity();
    await expect(tx((c) => join(c, actor.id, a, now))).rejects.toThrow("המלאי");
  });
  it("randomizes 300 waiting participants, appends late arrivals and never oversells", async () => {
    await resetStock(4);
    const a = await activity();
    const opening = new Date(+now + 10000);
    await db.query("UPDATE activities SET opens_at=$2 WHERE id=$1", [
      a,
      opening,
    ]);
    const people: User[] = [];
    for (let i = 0; i < 300; i++) people.push(await person("מדריך " + i));
    await Promise.all(
      people.map((p) => tx((c) => join(c, p.id, a, new Date(+now - 1000)))),
    );
    expect(
      (
        await db.query(
          "SELECT id FROM queue_entries WHERE activity_id=$1 AND state='WAITING_ROOM'",
          [a],
        )
      ).rows,
    ).toHaveLength(300);
    await tx((c) => tick(c, opening));
    const q = (
      await db.query<{ unit_id: string; position: number; state: string }>(
        "SELECT * FROM queue_entries WHERE activity_id=$1 ORDER BY position",
        [a],
      )
    ).rows;
    expect(q).toHaveLength(300);
    expect(new Set(q.map((e) => e.position)).size).toBe(300);
    expect(q.filter((e) => e.state === "OFFERED")).toHaveLength(4);
    const rankByUnit = new Map(
      await Promise.all(
        people.map(async (p, index) => [await unit(db, p.id), index] as const),
      ),
    );
    const earlyHalfRankMean =
      q
        .slice(0, 150)
        .reduce((sum, entry) => sum + rankByUnit.get(entry.unit_id)!, 0) / 150;
    expect(earlyHalfRankMean).toBeGreaterThan(105);
    expect(earlyHalfRankMean).toBeLessThan(195);
    const late = await person();
    await tx((c) => join(c, late.id, a, opening));
    expect(
      (
        await one<{ position: number }>(
          db,
          "SELECT position FROM queue_entries WHERE activity_id=$1 AND unit_id=$2",
          [a, await unit(db, late.id)],
        )
      ).position,
    ).toBe(301);
    expect(await capacity(db, a)).toBe(0);
    await tx((c) => join(c, late.id, a, now));
    expect(
      (await db.query("SELECT id FROM queue_entries WHERE activity_id=$1", [a]))
        .rows,
    ).toHaveLength(301);
  }, 60000);
  it("keeps simultaneous queue workers idempotent under row locking", async () => {
    await resetStock();
    const a = await activity();
    await db.query("UPDATE activities SET opens_at=$2 WHERE id=$1", [
      a,
      new Date(+now + 10000),
    ]);
    const x = await person();
    await tx((c) => rawJoin(c, x.id, a, now));
    const workerTime = new Date(+now + 10000);
    await Promise.all(
      Array.from({ length: 4 }, () => tx((c) => tick(c, workerTime))),
    );
    expect(
      (
        await db.query(
          "SELECT o.id FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id WHERE q.activity_id=$1 AND o.state='ACTIVE'",
          [a],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT o.id FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id WHERE q.activity_id=$1",
          [a],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("shares one offer and idempotent reservation across simultaneous partner confirmations", async () => {
    await resetStock();
    const a = await activity();
    const x = await person(),
      y = await person();
    await tx((c) => partnership(c, x, "request", y.id));
    const request = await one<{ id: string }>(
      db,
      "SELECT id FROM partnership_requests WHERE sender_id=$1",
      [x.id],
    );
    await tx((c) => partnership(c, y, "accept", request.id));
    await Promise.all([
      tx((c) => join(c, x.id, a, now)),
      tx((c) => join(c, y.id, a, now)),
    ]);
    const ids = await Promise.all([
      tx((c) => confirm(c, x.id, a, now)),
      tx((c) => confirm(c, y.id, a, now)),
    ]);
    expect(ids[0].id).toBe(ids[1].id);
    expect(
      (await db.query("SELECT id FROM queue_entries WHERE activity_id=$1", [a]))
        .rows,
    ).toHaveLength(1);
    expect(await capacity(db, a)).toBe(0);
    await expect(
      tx((c) => partnership(c, actor, "dissolve", x.id)),
    ).rejects.toThrow();
  });
  it("rejects exact deadline, expires without browser activity and promotes waitlist", async () => {
    await resetStock();
    const a = await activity(),
      x = await person(),
      y = await person();
    await tx((c) => join(c, x.id, a, now));
    await tx((c) => join(c, y.id, a, now));
    await expect(
      tx((c) => confirm(c, x.id, a, new Date(+now + 90000))),
    ).rejects.toThrow();
    await tx((c) => tick(c, new Date(+now + 90000)));
    expect(
      (
        await one<{ state: string }>(
          db,
          "SELECT state FROM queue_entries WHERE activity_id=$1 AND unit_id=$2",
          [a, await unit(db, x.id)],
        )
      ).state,
    ).toBe("OFFER_EXPIRED");
    expect(
      (
        await one<{ state: string }>(
          db,
          "SELECT state FROM queue_entries WHERE activity_id=$1 AND unit_id=$2",
          [a, await unit(db, y.id)],
        )
      ).state,
    ).toBe("OFFERED");
    await tx((c) => tick(c, new Date(+now + 90001)));
    expect(
      (await db.query("SELECT id FROM queue_offers WHERE state='ACTIVE'")).rows,
    ).toHaveLength(1);
  });
  it("accepts immediately before deadline, cancellation frees a hold for next unit", async () => {
    await resetStock();
    const a = await activity(),
      x = await person(),
      y = await person();
    await tx((c) => join(c, x.id, a, now));
    await tx((c) => join(c, y.id, a, now));
    const r = await tx((c) => confirm(c, x.id, a, new Date(+now + 89999)));
    await tx((c) => cancel(c, x.id, r.id));
    expect(
      (
        await one<{ state: string }>(
          db,
          "SELECT state FROM queue_entries WHERE activity_id=$1 AND unit_id=$2",
          [a, await unit(db, y.id)],
        )
      ).state,
    ).toBe("OFFERED");
    await expect(
      tx((c) => confirm(c, y.id, a, new Date(+now + 200000))),
    ).rejects.toThrow();
  });
  it("duplicate scans create one loan and transaction; return restores physical stock", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await tx((c) => join(c, x.id, a, now));
    const r = await tx((c) => confirm(c, x.id, a, now));
    const token = (
      await one<{ qr_token: string }>(
        db,
        "SELECT qr_token FROM reservations WHERE id=$1",
        [r.id],
      )
    ).qr_token;
    await expect(tx((c) => warehouse(c, x, token, "pickup"))).rejects.toThrow();
    await Promise.all([
      tx((c) => warehouse(c, actor, token, "pickup")),
      tx((c) => warehouse(c, actor, token, "pickup")),
    ]);
    expect(
      (
        await db.query(
          "SELECT * FROM equipment_loans WHERE reservation_id=$1",
          [r.id],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(tx((c) => cancel(c, x.id, r.id))).rejects.toThrow();
    const next = await activity(86400000);
    expect(await capacity(db, next)).toBe(0);
    await Promise.all([
      tx((c) => warehouse(c, actor, token, "return")),
      tx((c) => warehouse(c, actor, token, "return")),
    ]);
    expect(await capacity(db, next)).toBe(1);
    expect(
      (
        await db.query(
          "SELECT * FROM inventory_transactions WHERE reservation_id=$1",
          [r.id],
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("activity cancellation closes offers and cancels undelivered reservations", async () => {
    await resetStock(2);
    const a = await activity(),
      x = await person(),
      y = await person();
    await tx((c) => join(c, x.id, a, now));
    await tx((c) => join(c, y.id, a, now));
    const r = await tx((c) => confirm(c, x.id, a, now));
    await tx((c) =>
      administer(c, actor, {
        action: "queue",
        data: { id: a, operation: "cancel" },
      }),
    );
    expect(
      (
        await one<{ status: string }>(
          db,
          "SELECT status FROM reservations WHERE id=$1",
          [r.id],
        )
      ).status,
    ).toBe("CANCELLED");
    await expect(tx((c) => confirm(c, y.id, a, now))).rejects.toThrow();
  });
  it("manual overrides are audited and cannot oversell", async () => {
    await resetStock();
    const a = await activity(),
      x = await person(),
      y = await person();
    await tx((c) => manual(c, actor, x.id, a, "טלפון לא זמין, אישור רכז"));
    await expect(
      tx((c) => manual(c, actor, y.id, a, "טלפון לא זמין, אישור רכז")),
    ).rejects.toThrow();
    expect(
      await one(
        db,
        "SELECT id FROM audit_logs WHERE action='MANUAL_RESERVATION'",
      ),
    ).toBeTruthy();
  });
  it("rejects a reduction below live allocations", async () => {
    await expect(
      tx((c) =>
        administer(c, actor, {
          action: "inventory",
          data: { total: 0, damaged: 0 },
        }),
      ),
    ).rejects.toThrow();
  });
  it("restart is idempotent and persistent entries survive reconnect", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await tx((c) => join(c, x.id, a, now));
    const before = await one(
      db,
      "SELECT * FROM queue_entries WHERE activity_id=$1",
      [a],
    );
    await tx((c) => tick(c, new Date(+now + 1000)));
    await tx((c) => tick(c, new Date(+now + 1000)));
    expect(
      await one(db, "SELECT * FROM queue_entries WHERE activity_id=$1", [a]),
    ).toEqual(before);
  });
});
describe("Jerusalem scheduling", () => {
  it("converts winter and summer correctly and uses exactly 24 elapsed hours", () => {
    const winter = activityTimes("2026-01-06", "17:00", "19:00");
    const summer = activityTimes("2026-07-07", "17:00", "19:00");
    expect(winter.starts.toISOString()).toContain("15:00:00");
    expect(summer.starts.toISOString()).toContain("14:00:00");
    for (const day of ["2026-03-27", "2026-10-25"]) {
      const t = activityTimes(day, "17:00", "19:00");
      expect(+t.starts - +t.opens).toBe(86400000);
      expect(+t.opens - +t.waiting).toBe(900000);
    }
  });
});
describe("recovery and boundary conditions", () => {
  it("rolls back a crashed worker before retry without duplicate holds", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await tx((c) => rawJoin(c, x.id, a, new Date(+now - 1000)));
    await expect(
      tx(async (c) => {
        await tick(c, now);
        throw new Error("simulated crash");
      }),
    ).rejects.toThrow("simulated crash");
    expect(
      (
        await one<{ state: string }>(
          db,
          "SELECT state FROM queue_entries WHERE activity_id=$1",
          [a],
        )
      ).state,
    ).toBe("WAITING_ROOM");
    await tx((c) => tick(c, now));
    expect(
      (
        await db.query(
          "SELECT o.id FROM queue_offers o JOIN queue_entries q ON q.id=o.entry_id WHERE q.activity_id=$1 AND o.state='ACTIVE'",
          [a],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects entry before waiting room opens", async () => {
    await resetStock();
    const a = await activity(3600000);
    await expect(tx((c) => rawJoin(c, actor.id, a, now))).rejects.toThrow(
      "סגור",
    );
  });
  it("rejects queue entry after closing", async () => {
    await resetStock();
    const a = await activity();
    await expect(
      tx((c) => rawJoin(c, actor.id, a, new Date(+now + 3600000))),
    ).rejects.toThrow("סגור");
  });
  it("pauses offers without changing the randomized position", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await db.query("UPDATE activities SET paused=true WHERE id=$1", [a]);
    await tx((c) => join(c, x.id, a, now));
    const q = await one<{ position: number; state: string }>(
      db,
      "SELECT * FROM queue_entries WHERE activity_id=$1",
      [a],
    );
    expect(q.state).toBe("QUEUED");
    await tx((c) =>
      administer(c, actor, {
        action: "queue",
        data: { id: a, operation: "resume" },
      }),
    );
    const resumed = await one<{ position: number; state: string }>(
      db,
      "SELECT * FROM queue_entries WHERE activity_id=$1",
      [a],
    );
    expect(resumed.position).toBe(q.position);
    expect(resumed.state).toBe("OFFERED");
  });
  it("does not issue a shortened offer near registration close", async () => {
    await resetStock();
    const a = await activity();
    await tx((c) => join(c, actor.id, a, new Date(+now + 3590000)));
    expect(
      (
        await one<{ state: string }>(
          db,
          "SELECT state FROM queue_entries WHERE activity_id=$1",
          [a],
        )
      ).state,
    ).toBe("WAITLISTED");
  });
  it("rejects an unknown QR without changing physical inventory", async () => {
    await resetStock(2);
    await expect(
      tx((c) => warehouse(c, actor, randomUUID(), "pickup")),
    ).rejects.toThrow("קוד לא מוכר");
    const inv = await one<{ total: number }>(
      db,
      "SELECT total FROM inventory_items WHERE id='mat'",
    );
    expect(inv.total).toBe(2);
  });
  it("refuses pickup for a different future activity", async () => {
    await resetStock();
    const a = await activity(86400000),
      x = await person();
    await tx((c) => manual(c, actor, x.id, a, "מקרה חריג לצורך בדיקה"));
    const r = await one<{ qr_token: string }>(
      db,
      "SELECT qr_token FROM reservations WHERE activity_id=$1",
      [a],
    );
    await expect(
      tx((c) => warehouse(c, actor, r.qr_token, "pickup")),
    ).rejects.toThrow("המסירה");
  });
  it("keeps distributed loans after activity cancellation", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await tx((c) => join(c, x.id, a, now));
    const r = await tx((c) => confirm(c, x.id, a, now));
    const token = (
      await one<{ qr_token: string }>(
        db,
        "SELECT qr_token FROM reservations WHERE id=$1",
        [r.id],
      )
    ).qr_token;
    await tx((c) => warehouse(c, actor, token, "pickup"));
    await tx((c) =>
      administer(c, actor, {
        action: "queue",
        data: { id: a, operation: "cancel" },
      }),
    );
    expect(
      (
        await one<{ status: string }>(
          db,
          "SELECT status FROM reservations WHERE id=$1",
          [r.id],
        )
      ).status,
    ).toBe("DISTRIBUTED");
    await tx((c) => warehouse(c, actor, token, "return"));
  });
  it("prevents cross-team partnership requests", async () => {
    const x = await person(),
      y = await person();
    const other = await one<{ id: string }>(
      db,
      "INSERT INTO scout_teams(name) VALUES('קבוצה נוספת') RETURNING id",
    );
    await db.query("UPDATE users SET team_id=$1 WHERE id=$2", [other.id, y.id]);
    await expect(
      tx((c) => partnership(c, x, "request", y.id)),
    ).rejects.toThrow();
  });
  it("preserves the historical borrower snapshot after partnership changes", async () => {
    await resetStock();
    const a = await activity(),
      x = await person("שם היסטורי");
    await tx((c) => join(c, x.id, a, now));
    const r = await tx((c) => confirm(c, x.id, a, now));
    await db.query("UPDATE users SET name=$1 WHERE id=$2", ["שם חדש", x.id]);
    expect(
      (
        await one<{ names: string }>(
          db,
          "SELECT names FROM reservations WHERE id=$1",
          [r.id],
        )
      ).names,
    ).toBe("שם היסטורי");
  });
  it("shares capacity between overlapping activity instances", async () => {
    await resetStock();
    const a = await activity(),
      b = await activity(60000),
      x = await person();
    await tx((c) => join(c, x.id, a, now));
    expect(await capacity(db, b)).toBe(0);
  });
  it("cannot dissolve an expired participant out of a still-open activity to rejoin", async () => {
    await resetStock();
    const a = await activity(),
      x = await person();
    await tx((c) => join(c, x.id, a, now));
    await tx((c) => tick(c, new Date(+now + 90001)));
    await expect(
      tx((c) => partnership(c, actor, "dissolve", x.id)),
    ).rejects.toThrow();
  });
});
