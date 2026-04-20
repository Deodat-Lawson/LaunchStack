import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  let dbStatus: "connected" | "error" = "error";
  let dbLatencyMs = -1;

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "connected";
  } catch (error) {
    console.error("[health] DB check failed:", error);
  }

  const healthy = dbStatus === "connected";
  const totalMs = Date.now() - start;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
      },
      responseTimeMs: totalMs,
    },
    { status: healthy ? 200 : 503 },
  );
}
