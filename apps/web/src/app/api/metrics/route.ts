import { NextResponse } from "next/server";
import { getMetricsSnapshot, metricsRegistry } from "~/server/metrics/registry";
import { isMetricsRequestAuthorized } from "~/server/security/metrics-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
    // Requires `Authorization: Bearer <METRICS_BEARER_TOKEN>` when the token
    // is configured; legacy-open (with a one-time warning) when it is not.
    if (!isMetricsRequestAuthorized(request)) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await getMetricsSnapshot();
        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": metricsRegistry.contentType
            }
        });
    } catch (error) {
        console.error("Metrics endpoint error:", error);
        return NextResponse.json(
            { message: "Metrics not available" },
            { status: 503 }
        );
    }
}
