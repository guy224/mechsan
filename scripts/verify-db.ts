import { readFile } from "node:fs/promises";
import { database, logError } from "../lib/db";
import { inspectSchema, verifyRequiredData } from "../lib/schema";
async function run() {
  const pool = database();
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ ONLY");
    await db.query("SET LOCAL search_path TO public");
    const expected = JSON.parse(
      await readFile("db/schema-manifest.json", "utf8"),
    );
    const actual = await inspectSchema(db);
    const differences = Object.keys(expected).filter(
      (key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]),
    );
    if (differences.length)
      console.error(
        "Schema categories requiring review:",
        differences.join(", "),
      );
    if (differences.length)
      throw new Error("Schema differences: " + differences.join(", "));
    await verifyRequiredData(db);
    const permissions = await db.query<{ valid: boolean }>(
      `SELECT has_schema_privilege(current_user,'machsan','USAGE') AND bool_and(has_table_privilege(current_user,c.oid,'SELECT')) AND bool_and(CASE WHEN c.relname='migrations' THEN true ELSE has_table_privilege(current_user,c.oid,'INSERT') END) AND bool_and(CASE WHEN c.relname IN ('migrations','audit_logs','inventory_transactions') THEN true ELSE has_table_privilege(current_user,c.oid,'UPDATE') END) AND has_table_privilege(current_user,'machsan.rate_limits','DELETE') AND has_function_privilege(current_user,'machsan.reservation_snapshot()','EXECUTE') AS valid FROM pg_class c WHERE c.relnamespace='machsan'::regnamespace AND c.relkind='r'`,
    );
    if (!permissions.rows[0]?.valid)
      throw new Error("Runtime permissions missing");
    await db.query("COMMIT");
    console.log(
      "Schema definitions, required records and runtime permissions verified.",
    );
  } finally {
    db.release(true);
    await pool.end();
  }
}
run().catch((error) => {
  logError("database_verification", error);
  console.error(
    "Verification failed: compare schema-manifest.json with the database catalog; no changes were made.",
  );
  process.exitCode = 1;
});
