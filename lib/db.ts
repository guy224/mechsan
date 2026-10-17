import { Pool } from "pg";
import { readFileSync } from "node:fs";
export interface DB {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
let pool: Pool;
function databaseTls() {
  const caValue = process.env.DATABASE_SSL_ROOT_CERT;
  if (caValue) {
    try {
      // Local deployments can point at a certificate file. Netlify and other
      // hosted runtimes cannot rely on a file being present, so they may pass
      // the PEM certificate itself as the environment variable value.
      const ca = caValue.includes("BEGIN CERTIFICATE")
        ? caValue.replace(/\\n/g, "\n")
        : readFileSync(caValue, "utf8");
      return {
        ca,
        rejectUnauthorized: true,
      };
    } catch {
      throw new Error("DATABASE_SSL_ROOT_CERT could not be read");
    }
  }
  const hostname = new URL(process.env.DATABASE_URL!).hostname;
  const isSupabase =
    hostname.endsWith(".supabase.co") ||
    hostname.endsWith(".pooler.supabase.com");
  const allowInsecureLocal =
    process.env.NODE_ENV !== "production" &&
    process.env.DATABASE_SSL_ALLOW_INSECURE_LOCAL === "true";
  return process.env.NODE_ENV === "production" || (isSupabase && !allowInsecureLocal)
    ? { rejectUnauthorized: true }
    : isSupabase
      ? { rejectUnauthorized: false }
    : undefined;
}
function databaseUrl() {
  const url = new URL(process.env.DATABASE_URL!);
  // The `pg` URL parser can replace the explicit TLS options with sslmode
  // query parameters. Keep TLS policy in one place so CA verification sticks.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"])
    url.searchParams.delete(key);
  return url.toString();
}
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return (pool ??= new Pool({
    connectionString: databaseUrl(),
ssl: databaseTls(),
max: 2,
idleTimeoutMillis: 10000,
connectionTimeoutMillis: 5000,
    options: "-c search_path=machsan,public",
    statement_timeout: 15000,
  }));
}
export async function transaction<T>(
  fn: (db: DB) => Promise<T>,
  notify = true,
): Promise<T> {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM operation_lock WHERE id=1 FOR UPDATE");
    const result = await fn(c);
    if (notify) await c.query("SELECT pg_notify('machsan_changed','')");
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function one<T>(db: DB, sql: string, values: unknown[] = []) {
  return (await db.query<T>(sql, values)).rows[0];
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  message = "הפעולה אינה זמינה",
  status = 400,
): asserts value {
  if (!value) throw new AppError(message, status);
}
