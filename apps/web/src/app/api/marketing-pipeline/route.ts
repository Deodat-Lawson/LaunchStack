import { NextResponse } from "next/server";
import {
    MarketingPipelineInputSchema,
    runMarketingPipeline,
} from "@launchstack/features/marketing-pipeline";
import type { PipelineSSEEvent } from "@launchstack/features/marketing-pipeline";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Thrown from the onProgress callback when the client has disconnected.
 * `runMarketingPipeline` does not take an AbortSignal, but progress events are
 * emitted throughout the run, so throwing here stops the pipeline at the next
 * emission instead of letting it run (and bill LLM calls) to completion for
 * nobody.
 */
class ClientDisconnectedError extends Error {
    constructor() {
        super("Client disconnected — marketing pipeline aborted");
        this.name = "ClientDisconnectedError";
    }
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        let body: unknown;
        try {
            body = (await request.json()) as unknown;
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid JSON body",
                    error: "Request body must be valid JSON",
                },
                { status: 400 }
            );
        }
        const validation = MarketingPipelineInputSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid input",
                    errors: validation.error.flatten(),
                },
                { status: 400 }
            );
        }

        const companyId = Number(ctx.data.companyId);
        if (Number.isNaN(companyId)) {
            return NextResponse.json(
                { success: false, message: "Invalid company ID" },
                { status: 400 }
            );
        }

        const url = new URL(request.url);
        const debug = url.searchParams.get("debug") === "true";

        const encoder = new TextEncoder();
        // Tracks whether the SSE stream has been torn down — either because the
        // client disconnected (tab close, navigation, refresh) or the stream
        // finished. Guards every enqueue/close so a still-running pipeline does
        // not throw "Invalid state: Controller is already closed" when it emits
        // progress after the client has gone away.
        let closed = false;

        const stream = new ReadableStream({
            async start(controller) {
                const onAbort = () => {
                    closed = true;
                };
                request.signal.addEventListener("abort", onAbort);

                function send(event: PipelineSSEEvent) {
                    if (closed) return;
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                    } catch {
                        // Controller already closed (client disconnected mid-stream).
                        closed = true;
                    }
                }

                try {
                    const result = await runMarketingPipeline({
                        companyId,
                        input: validation.data,
                        debug,
                        onProgress: progressEvent => {
                            if (request.signal.aborted) {
                                throw new ClientDisconnectedError();
                            }
                            send(progressEvent);
                        },
                    });

                    send({ type: "result", success: true, data: result });
                } catch (error) {
                    // A disconnect abort is an expected outcome, not a pipeline
                    // failure: skip the error event (muted anyway) and the
                    // error-level log, and let `finally` close the stream.
                    if (error instanceof ClientDisconnectedError || request.signal.aborted) {
                        console.log(
                            "[marketing-pipeline] client disconnected — pipeline stopped early"
                        );
                        return;
                    }

                    const errMessage = error instanceof Error ? error.message : String(error);
                    console.error("[marketing-pipeline] POST error:", error);

                    const normalizedError = errMessage.toLowerCase();
                    const hint =
                        normalizedError.includes("chat_base_url") ||
                        normalizedError.includes("chat model") ||
                        normalizedError.includes("route") ||
                        normalizedError.includes("api_key")
                            ? " Ensure CHAT_BASE_URL (and CHAT_API_KEY if required) are set and the chat model configuration file is valid."
                            : normalizedError.includes("company")
                              ? " Ensure your user has a valid company profile."
                              : "";

                    send({
                        type: "error",
                        success: false,
                        message: "Failed to run marketing pipeline" + hint,
                    });
                } finally {
                    request.signal.removeEventListener("abort", onAbort);
                    if (!closed) {
                        closed = true;
                        try {
                            controller.close();
                        } catch {
                            // Already closed by the runtime after client disconnect.
                        }
                    }
                }
            },
            cancel() {
                // Consumer cancelled the stream (client went away).
                closed = true;
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        });
    } catch (error) {
        console.error("[marketing-pipeline] POST error:", error);

        return NextResponse.json(
            {
                success: false,
                message: "Failed to run marketing pipeline",
            },
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
