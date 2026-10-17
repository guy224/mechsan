import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  on: vi.fn(),
  config: {} as Record<string, unknown>,
}));
vi.mock("pg", () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      mocks.config = config;
    }
    query = mocks.query;
    connect = mocks.connect;
    on = mocks.on;
  },
}));
import { database, transaction, realtimeEnabled, logError } from "../lib/db";
beforeEach(() => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://test:password@ep-example-pooler.eu.neon.tech/neondb?sslmode=require",
  );
  vi.stubEnv("DATABASE_SSL_ROOT_CERT", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NETLIFY", "");
  vi.stubEnv("DATABASE_REALTIME", "false");
  delete (globalThis as { machsanPool?: unknown }).machsanPool;
  vi.clearAllMocks();
  mocks.query.mockReset().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("reuses a bounded pool and validates Neon TLS even in development", () => {
  expect(database()).toBe(database());
  expect(mocks.config).toMatchObject({
    max: 2,
    ssl: { rejectUnauthorized: true },
  });
  expect(mocks.config).not.toHaveProperty("options");
  expect(mocks.config).not.toHaveProperty("statement_timeout");
  expect(
    new URL(mocks.config.connectionString as string).searchParams.has(
      "sslmode",
    ),
  ).toBe(false);
  expect(mocks.on).toHaveBeenCalledWith("error", expect.any(Function));
});
it("never enables session listeners on Neon pooling or Netlify", () => {
  vi.stubEnv("DATABASE_REALTIME", "true");
  expect(realtimeEnabled()).toBe(false);
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://test:password@ep-example.eu.neon.tech/neondb",
  );
  expect(realtimeEnabled()).toBe(true);
  vi.stubEnv("NETLIFY", "true");
  expect(realtimeEnabled()).toBe(false);
});
it("locks the explicit schema and uses transaction-local timeouts", async () => {
  await expect(transaction(async () => 42)).resolves.toBe(42);
  expect(mocks.query.mock.calls.map((c) => c[0])).toEqual([
    "BEGIN",
    "SET LOCAL statement_timeout = '15s'",
    "SELECT id FROM machsan.operation_lock WHERE id=1 FOR UPDATE",
    "COMMIT",
  ]);
  expect(mocks.release).toHaveBeenCalledWith(false);
});
it("refuses mutations if the singleton lock row is missing", async () => {
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: [],
    rowCount: sql.includes("operation_lock") ? 0 : 1,
  }));
  const mutation = vi.fn();
  await expect(transaction(mutation)).rejects.toThrow("DATABASE_LOCK_MISSING");
  expect(mutation).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
});
it("destroys broken clients without masking the original error", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql === "ROLLBACK") throw new Error("network");
    return { rows: [], rowCount: 1 };
  });
  await expect(
    transaction(async () => {
      throw new Error("original");
    }),
  ).rejects.toThrow("original");
  expect(mocks.release).toHaveBeenCalledWith(true);
});
it("logs only safe error codes, not credentials or SQL details", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  logError("test", {
    code: "42P01",
    message: "password",
    detail: "personal data",
  });
  expect(spy).toHaveBeenCalledWith("test", { code: "42P01" });
  spy.mockRestore();
});
