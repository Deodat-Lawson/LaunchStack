import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getEngine } from "~/server/engine";
import { env } from "~/env";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error" | "skipped";

interface Check {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

async function checkDb(): Promise<Check> {
  const start = Date.now();
  try {
    await getEngine().db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkNeo4j(): Promise<Check> {
  if (!env.server.NEO4J_URI) return { status: "skipped" };
  const start = Date.now();
  try {
    const driver = getEngine().neo4j();
    if (!driver) return { status: "skipped" };
    await driver.verifyConnectivity();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const start = Date.now();
  const [database, neo4j] = await Promise.all([checkDb(), checkNeo4j()]);

  const checks = { database, neo4j };
  const healthy = Object.values(checks).every(
    (check) => check.status !== "error",
  );
  const criticalOk = checks.database.status === "ok";

  return NextResponse.json(
    {
      status: criticalOk ? (healthy ? "ok" : "degraded") : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA ??
        "unknown",
      checks,
      responseTimeMs: Date.now() - start,
    },
    { status: criticalOk ? 200 : 503 },
  );
}
