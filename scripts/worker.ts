import { transaction, database, one } from "../lib/db";
import { tick } from "../lib/queue";
import { generateActivities } from "../lib/schedule";
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
async function run() {
  while (running) {
    for (const id of ["queue", "schedule"]) {
      try {
        await transaction(async (db) => {
          const job = await one(
            db,
            "SELECT id FROM background_jobs WHERE id=$1 AND run_at<=now() FOR UPDATE",
            [id],
          );
          if (!job) return;
          if (id === "queue") {
            const before = await db.query(
              "SELECT id,state FROM queue_entries WHERE state IN ('WAITING_ROOM','QUEUED','WAITLISTED','OFFERED') ORDER BY id",
            );
            await tick(db);
            const after = await db.query(
              "SELECT id,state FROM queue_entries WHERE state IN ('WAITING_ROOM','QUEUED','WAITLISTED','OFFERED') ORDER BY id",
            );
            if (JSON.stringify(before.rows) !== JSON.stringify(after.rows))
              await db.query("SELECT pg_notify('machsan_changed','')");
          } else await generateActivities(db);
          await db.query(
            "UPDATE background_jobs SET attempts=0,last_success=now(),last_error=NULL,run_at=now()+($2*interval '1 second') WHERE id=$1",
            [id, id === "queue" ? 1 : 3600],
          );
          await db.query(
            "DELETE FROM rate_limits WHERE reset_at<now()-interval '1 day'",
          );
        }, false);
      } catch (e) {
        console.error(
          "Worker job failed",
          id,
          e instanceof Error ? e.message : "unknown",
        );
        try {
          await database().query(
            "UPDATE background_jobs SET attempts=attempts+1,last_error='Job failed; inspect worker logs',run_at=now()+least(60,power(2,least(attempts,6))) * interval '1 second' WHERE id=$1",
            [id],
          );
        } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await database().end();
}
run();
