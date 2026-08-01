import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getMetricsSnapshot, metricsRegistry } from "~/server/metrics/registry";
import { env } from "~/env";

export const runtime = "nodejs";

function bearerMatches(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();
  if (!provided || provided.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const scrapeToken = env.server.METRICS_SCRAPE_TOKEN;
  // Prefer VERCEL_ENV so tests can flip production without fighting Jest's
  // frozen NODE_ENV=test.
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  // Fail closed in production when no scrape token is configured.
  if (!scrapeToken) {
    if (isProd) {
      return NextResponse.json(
        { message: "Metrics scrape token not configured" },
        { status: 503 },
      );
    }
  } else if (!bearerMatches(request.headers.get("authorization"), scrapeToken)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await getMetricsSnapshot();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": metricsRegistry.contentType,
      },
    });
  } catch (error) {
    console.error("Metrics endpoint error:", error);
    return NextResponse.json(
      { message: "Metrics not available" },
      { status: 503 },
    );
  }
}
