import type { DB } from "./db";
// Catalog-only inspection: safe to run against production, no data changes.
export async function inspectSchema(db: DB) {
  const queries = {
    columns: `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='machsan' ORDER BY table_name,ordinal_position`,
    constraints: `SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='machsan'::regnamespace AND k.contype<>'n' ORDER BY c.relname,k.conname`,
    indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='machsan' ORDER BY tablename,indexname`,
    triggers: `SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='machsan'::regnamespace AND NOT t.tgisinternal ORDER BY t.tgname`,
    functions: `SELECT p.proname,p.prosrc,p.proconfig,p.prosecdef FROM pg_proc p WHERE p.pronamespace='machsan'::regnamespace ORDER BY p.proname`,
  };
  const result: Record<string, unknown> = {};
  for (const [key, sql] of Object.entries(queries))
    result[key] = (await db.query(sql)).rows;
  return result;
}
export async function verifyRequiredData(db: DB) {
  const result = await db.query<{ valid: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM machsan.migrations WHERE version='001') AND
    EXISTS(SELECT 1 FROM machsan.operation_lock WHERE id=1) AND
    (SELECT count(*)=2 FROM machsan.background_jobs WHERE id IN ('queue','schedule')) AS valid`);
  if (!result.rows[0]?.valid) throw new Error("DATABASE_REQUIRED_ROWS_MISSING");
}
