import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
    CallNotesApplicationError,
    CallQuerySchema,
    callNotesEnrichmentRuns,
    type CallSnapshot,
    type EnrichmentStatus,
} from "@launchstack/pipelines/call-notes";
import {
    EnrichmentStreamEventSchema,
    type EnrichmentStreamEvent,
} from "~/lib/call-notes-enrichment-stream";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    callNotesErrorResponse,
    getWebCallNotesApplication,
} from "~/server/call-notes/application";
import { getEngine } from "~/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PREVIEW_MAX_LENGTH = 120_000;
const POLL_INTERVAL_MS = 500;

type EnrichmentRunState = {
    status: EnrichmentStatus;
    previewMarkdown: string | null;
};

type AuthorizedEnrichmentState = {
    snapshot: CallSnapshot;
    run: EnrichmentRunState;
};

function invalidRequest(): NextResponse {
    return NextResponse.json({ error: "Invalid Call Notes request" }, { status: 400 });
}

function missingEnrichment(): CallNotesApplicationError {
    return new CallNotesApplicationError("not_found", "Enrichment run not found");
}

function isTerminalStatus(
    status: EnrichmentStatus
): status is Exclude<EnrichmentStatus, "queued" | "generating"> {
    return status !== "queued" && status !== "generating";
}

function boundedPreview(markdown: string | null): string {
    return (markdown ?? "").slice(0, PREVIEW_MAX_LENGTH);
}

function encodeEvent(event: EnrichmentStreamEvent, encoder: TextEncoder): Uint8Array {
    const validated = EnrichmentStreamEventSchema.parse(event);
    return encoder.encode(`data: ${JSON.stringify(validated)}\n\n`);
}

async function readRun(
    companyId: string,
    callId: string,
    runId: string
): Promise<EnrichmentRunState | null> {
    const [run] = await getEngine()
        .db.select({
            status: callNotesEnrichmentRuns.status,
            previewMarkdown: callNotesEnrichmentRuns.previewMarkdown,
        })
        .from(callNotesEnrichmentRuns)
        .where(
            and(
                eq(callNotesEnrichmentRuns.id, runId),
                eq(callNotesEnrichmentRuns.callId, callId),
                eq(callNotesEnrichmentRuns.companyId, BigInt(companyId))
            )
        )
        .limit(1);
    return run ?? null;
}

async function readAuthorizedState(
    companyId: string,
    actorUserId: string,
    callId: string,
    runId: string
): Promise<AuthorizedEnrichmentState | null> {
    let snapshot = await getWebCallNotesApplication().getCall({
        companyId,
        actorUserId,
        callId,
    });
    const exposedEnrichment = snapshot.enrichment;
    if (!snapshot.note || !exposedEnrichment || exposedEnrichment.id !== runId) return null;

    const run = await readRun(companyId, callId, runId);
    if (!run) return null;
    if (isTerminalStatus(run.status) && exposedEnrichment.status !== run.status) {
        snapshot = await getWebCallNotesApplication().getCall({
            companyId,
            actorUserId,
            callId,
        });
        const refreshedEnrichment = snapshot.enrichment;
        if (
            !snapshot.note ||
            !refreshedEnrichment ||
            refreshedEnrichment.id !== runId ||
            refreshedEnrichment.status !== run.status
        ) {
            return null;
        }
    }
    return { snapshot, run };
}

function streamErrorMessage(error: unknown): string {
    if (error instanceof CallNotesApplicationError) {
        if (error.code === "not_found" || error.code === "forbidden") {
            return "This Call Note is no longer available.";
        }
    }
    return "The enrichment stream is no longer available. Please retry.";
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ callId: string }> }
): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const userId = workspace.data.authUserId;

        const { callId } = await params;
        const runId = new URL(request.url).searchParams.get("run");
        if (!runId) return invalidRequest();

        const companyId = workspace.data.companyId.toString();
        const parsed = CallQuerySchema.safeParse({
            companyId,
            actorUserId: userId,
            callId,
        });
        if (!parsed.success) return invalidRequest();

        const initial = await readAuthorizedState(companyId, userId, callId, runId);
        if (!initial) throw missingEnrichment();

        const encoder = new TextEncoder();
        let releaseStream: (() => void) | undefined;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                let stopped = false;
                let timer: NodeJS.Timeout | null = null;
                let lastStatus: "queued" | "generating" | null = null;
                let lastMarkdown: string | null = null;

                const release = () => {
                    if (timer !== null) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    request.signal.removeEventListener("abort", finish);
                    stopped = true;
                };
                releaseStream = release;
                const finish = () => {
                    if (stopped) return;
                    release();
                    controller.close();
                };
                const send = (event: EnrichmentStreamEvent) => {
                    if (!stopped) controller.enqueue(encodeEvent(event, encoder));
                };
                const sendErrorAndFinish = (message: string) => {
                    if (stopped) return;
                    send({ type: "error", message });
                    finish();
                };

                request.signal.addEventListener("abort", finish, { once: true });
                if (request.signal.aborted) {
                    finish();
                    return;
                }

                const poll = async (): Promise<void> => {
                    if (stopped) return;
                    try {
                        const current = await readAuthorizedState(companyId, userId, callId, runId);
                        if (!current) {
                            sendErrorAndFinish("This Call Note is no longer available.");
                            return;
                        }
                        if (isTerminalStatus(current.run.status)) {
                            send({ type: "complete", snapshot: current.snapshot });
                            finish();
                            return;
                        }

                        const markdown = boundedPreview(current.run.previewMarkdown);
                        if (current.run.status !== lastStatus || markdown !== lastMarkdown) {
                            send({
                                type: "progress",
                                runId,
                                status: current.run.status,
                                markdown,
                            });
                            lastStatus = current.run.status;
                            lastMarkdown = markdown;
                        }
                        if (!stopped) {
                            timer = setTimeout(() => {
                                timer = null;
                                void poll().catch(error => {
                                    sendErrorAndFinish(streamErrorMessage(error));
                                });
                            }, POLL_INTERVAL_MS);
                        }
                    } catch (error) {
                        sendErrorAndFinish(streamErrorMessage(error));
                    }
                };

                if (isTerminalStatus(initial.run.status)) {
                    send({ type: "complete", snapshot: initial.snapshot });
                    finish();
                    return;
                }

                const markdown = boundedPreview(initial.run.previewMarkdown);
                send({
                    type: "progress",
                    runId,
                    status: initial.run.status,
                    markdown,
                });
                lastStatus = initial.run.status;
                lastMarkdown = markdown;
                timer = setTimeout(() => {
                    timer = null;
                    void poll().catch(error => {
                        sendErrorAndFinish(streamErrorMessage(error));
                    });
                }, POLL_INTERVAL_MS);
            },
            cancel() {
                // Disconnecting only releases this polling stream; generation is independent.
                releaseStream?.();
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        });
    } catch (error) {
        return callNotesErrorResponse(error);
    }
}
