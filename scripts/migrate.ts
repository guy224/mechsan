import { readFile } from "node:fs/promises";
import { verifyRequiredData, inspectSchema } from "../lib/schema";
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
    await verifyRequiredData(c);
    const trigger = await c.query(
      "SELECT 1 FROM pg_trigger WHERE tgrelid='machsan.reservations'::regclass AND tgname='snapshot_borrowers' AND tgenabled='O'",
    );
    if (trigger.rowCount !== 1)
      throw new Error("Incomplete schema: reservation trigger missing");
    await c.query("SET LOCAL search_path TO public");
    const expected = JSON.parse(
      await readFile("db/schema-manifest.json", "utf8"),
    );
    const actual = await inspectSchema(c);
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw new Error("Incomplete or changed schema; run npm run verify:db");
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
