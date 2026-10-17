import { database, one, logError } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const r = await one<{ healthy: boolean }>(
      database(),
      "SELECT coalesce(last_success>now()-interval '30 seconds',false) healthy FROM machsan.background_jobs WHERE id='queue'",
    );
    return Response.json(
      { ok: !!r?.healthy, database: true, worker: !!r?.healthy },
      {
        status: r?.healthy ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logError("health", error);
    return Response.json(
      { ok: false, database: false, worker: false },
      { status: 503 },
    );
  }
}
