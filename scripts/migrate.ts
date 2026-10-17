import { readFile } from "node:fs/promises";
import { database } from "../lib/db";
async function run() {
  const p = database();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(914350)");
    const exists = await c.query(
      "SELECT to_regclass('machsan.migrations') AS t",
    );
    if (!exists.rows[0].t)
      await c.query(await readFile("db/001_initial.sql", "utf8"));
    await c.query("COMMIT");
    console.log("Migration complete");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await p.end();
  }
}
run().catch(() => {
  console.error(
    "Migration failed. Check database connectivity and permissions.",
  );
  process.exitCode = 1;
});
