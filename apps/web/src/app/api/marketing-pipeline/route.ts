import {
    MarketingPipelineInputSchema,
    runMarketingPipeline,
} from "@launchstack/pipelines/marketing";
import type { PipelineSSEEvent } from "@launchstack/pipelines/marketing";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { fail, readJson } from "~/server/api/responses";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Thrown from the onProgress callback when the client has disconnected.
 * The pipeline also receives `request.signal` directly (its stage runner
 * aborts between stages); this throw is the second line of defense, stopping
 * a stage already in flight at its next progress emission.
 */
class ClientDisconnectedError extends Error {
    constructor() {
        super("Client disconnected — marketing pipeline aborted");
        this.name = "ClientDisconnectedError";
    }
}

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "growth.server.marketing");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        return await withWorkspaceChatModels(ctx.data.companyId, "marketing", async () => {
            const validation = MarketingPipelineInputSchema.safeParse(await readJson(request));
            if (!validation.success) {
                return fail(translatorFor(locale, "errors.api")("invalidInput"), 400, {
                    errors: validation.error.flatten(),
                });
            }

            const companyId = Number(ctx.data.companyId);
            if (Number.isNaN(companyId)) {
                return fail(t("invalidCompanyId"), 400);
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
                            controller.enqueue(
                                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                            );
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
                            // Stops an abandoned run between stages (P2); the
                            // onProgress throw below remains as belt-and-suspenders
                            // for stages already in flight.
                            signal: request.signal,
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
                                ? "runFailedChat"
                                : normalizedError.includes("company")
                                  ? "runFailedCompany"
                                  : "runFailed";

                        send({ type: "error", success: false, message: t(hint) });
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
        });
    } catch (error) {
        console.error("[marketing-pipeline] POST error:", error);
        return fail(t("runFailed"), 500);
    }
}
