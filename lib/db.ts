import { Pool } from "pg";
import { readFileSync } from "node:fs";

export interface DB {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

const globalDb = globalThis as unknown as { machsanPool?: Pool };

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

  const isNeon = hostname.endsWith(".neon.tech");
  const isSupabase =
    hostname.endsWith(".supabase.co") ||
    hostname.endsWith(".pooler.supabase.com");

  const allowInsecureLocal =
    process.env.NODE_ENV !== "production" &&
    process.env.DATABASE_SSL_ALLOW_INSECURE_LOCAL === "true";

  return process.env.NODE_ENV === "production" ||
    isNeon ||
    (isSupabase && !allowInsecureLocal)
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
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  if (globalDb.machsanPool) return globalDb.machsanPool;
  const pool = new Pool({
    connectionString: databaseUrl(),
    ssl: databaseTls(),

    // Bound connections per serverless instance; reuse across warm requests.
    max: 2,

    // Close idle connections after 10 seconds.
    idleTimeoutMillis: 10000,

    // Stop waiting for a connection after 5 seconds.
    connectionTimeoutMillis: 5000,

    // Queries name their schema explicitly; no session startup parameters.
    query_timeout: 15000,
  });
  pool.on("error", (error) => logError("database_idle", error));
  globalDb.machsanPool = pool;
  return pool;
}

export async function transaction<T>(
  fn: (db: DB) => Promise<T>,
  notify = true,
): Promise<T> {
  const c = await database().connect();

  let broken = false;
  try {
    await c.query("BEGIN");

    await c.query("SET LOCAL statement_timeout = '15s'");
    const lock = await c.query(
      "SELECT id FROM machsan.operation_lock WHERE id=1 FOR UPDATE",
    );
    if (lock.rowCount !== 1) throw new Error("DATABASE_LOCK_MISSING");

    const result = await fn(c);

    if (notify && realtimeEnabled()) {
      await c.query("SELECT pg_notify('machsan_changed','')");
    }

    await c.query("COMMIT");

    return result;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw e;
  } finally {
    c.release(broken);
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
  if (!value) {
    throw new AppError(message, status);
  }
}

// LISTEN requires a persistent direct session, never a transaction pool.
export function realtimeEnabled() {
  if (process.env.DATABASE_REALTIME !== "true" || process.env.NETLIFY)
    return false;
  const host = new URL(process.env.DATABASE_URL!).hostname;
  return !host.includes("-pooler.") && !host.endsWith(".pooler.supabase.com");
}

export function logError(context: string, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  // Do not log messages/details: drivers can include SQL values or credentials.
  console.error(context, {
    code:
      typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
        ? code
        : "INTERNAL_ERROR",
  });
}
