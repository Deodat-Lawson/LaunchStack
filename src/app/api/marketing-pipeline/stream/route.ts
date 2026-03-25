import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { MarketingPipelineInputSchema } from "~/lib/tools/marketing-pipeline";
import { runMarketingPipeline } from "~/lib/tools/marketing-pipeline";
import type { PipelineStageEvent } from "~/lib/tools/marketing-pipeline/run";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const body = (await request.json()) as unknown;
    const validation = MarketingPipelineInputSchema.safeParse(body);
    if (!validation.success) {
        return new Response(
            JSON.stringify({ success: false, message: "Invalid input", errors: validation.error.flatten() }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        );
    }

    const [requestingUser] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

    if (!requestingUser) {
        return new Response(JSON.stringify({ success: false, message: "User not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    const companyId = Number(requestingUser.companyId);
    if (Number.isNaN(companyId)) {
        return new Response(JSON.stringify({ success: false, message: "Invalid company ID" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "true";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            function sendEvent(event: string, data: unknown) {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                );
            }

            const onStageUpdate = (stageEvent: PipelineStageEvent) => {
                sendEvent("stage", stageEvent);
            };

            try {
                const result = await runMarketingPipeline({
                    companyId,
                    input: validation.data,
                    debug,
                    onStageUpdate,
                });

                sendEvent("result", { success: true, data: result });
            } catch (error) {
                console.error("[marketing-pipeline/stream] error:", error);
                sendEvent("error", {
                    success: false,
                    message: error instanceof Error ? error.message : "Pipeline failed",
                });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
