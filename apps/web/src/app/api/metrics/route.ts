import { NextResponse } from "next/server";
import { getMetricsSnapshot, metricsRegistry } from "~/server/metrics/registry";

export const runtime = "nodejs";

export async function GET() {
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
