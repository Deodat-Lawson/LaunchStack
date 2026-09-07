"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
    CallSnapshotSchema,
    LocalCaptureWorkerStatusSchema,
    type CallNote,
    type CallSnapshot,
} from "@launchstack/features/call-notes/contracts";

import { CallsWorkspace, type CallMutationStatus, type CaptureCommand } from "./CallsWorkspace";
import { useCallNoteDrafts } from "./useCallNoteDrafts";
import { useEnrichmentStream } from "./useEnrichmentStream";

type EditableContent = Pick<CallNote, "contentRich" | "contentMarkdown">;

const CENTERED_STATE_STYLE = {
    display: "grid",
    placeItems: "center",
    flex: 1,
    width: "100%",
    minHeight: "100%",
    boxSizing: "border-box",
    padding: "48px 24px",
    background: "var(--bg)",
    color: "var(--ink)",
} as const;

type CaptureCommandRequest =
    | {
          kind: "start_capture";
          requestId: string;
          sourceOccurrenceKey: string;
          title?: string;
      }
    | {
          kind: "stop_capture";
          requestId: string;
          callId: string;
      };

type CallMutationRequest =
    | {
          kind: "set_note_visibility";
          requestId: string;
          callId: string;
          visibility: "company" | "private";
      }
    | {
          kind: "request_enrichment";
          requestId: string;
          callId: string;
      }
    | {
          kind: "reject_enrichment";
          requestId: string;
          callId: string;
          enrichmentRunId: string;
      }
    | {
          kind: "accept_enrichment";
          requestId: string;
          callId: string;
          enrichmentRunId: string;
          contentMarkdown: string;
          contentRich: Record<string, unknown>;
      }
    | {
          kind: "delete_call";
          requestId: string;
          callId: string;
      };

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
type CallMutationInput = WithoutRequestId<CallMutationRequest>;

type CaptureCommandState = {
    request: CaptureCommandRequest;
    phase: "pending" | "failed";
    error?: string;
};

type MutationState = {
    request: CallMutationRequest;
    phase: "pending" | "failed";
    error?: string;
};

type SnapshotSource = "poll" | "detail" | "mutation";

export interface CallsFeatureProps {
    onCallChanged?: () => void;
}

function requestId(): string {
    return crypto.randomUUID();
}

function commandErrorMessage(body: unknown, status: number): string {
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        return body.error;
    }
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
        return body.message;
    }
    return status > 0 ? `Call Notes command failed (${status})` : "Call Notes command failed";
}

function keepLatestNote(incoming: CallSnapshot, previous?: CallSnapshot): CallSnapshot {
    if (incoming.note && previous?.note && incoming.note.revision < previous.note.revision) {
        return { ...incoming, note: previous.note };
    }
    return incoming;
}

export function CallsFeature({ onCallChanged }: CallsFeatureProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const selectedCallId = searchParams.get("call");
    const [calls, setCalls] = useState<CallSnapshot[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [command, setCommand] = useState<CaptureCommandState | null>(null);
    const [captureUnavailableReason, setCaptureUnavailableReason] = useState<string | null>(
        "Checking the Local Capture Worker…"
    );
    const [mutations, setMutations] = useState<Record<string, MutationState>>({});
    const callsRef = useRef<CallSnapshot[]>([]);
    const pollSequenceRef = useRef(0);
    const pollInFlightRef = useRef(false);
    const initialLoadRef = useRef(true);
    const detailPendingRef = useRef<Set<string>>(new Set());
    const detailFailedRef = useRef<Set<string>>(new Set());
    const detailRetrySeenRef = useRef<Map<string, number>>(new Map());
    const [detailRetry, setDetailRetry] = useState(0);
    const onCallChangedRef = useRef(onCallChanged);
    onCallChangedRef.current = onCallChanged;

    const applySnapshot = useCallback((incoming: CallSnapshot, source: SnapshotSource): void => {
        // Audio timestamps are evidence times, not monotonic snapshot revisions.
        // A confirmed mutation invalidates reads that began before it completed.
        if (source === "mutation") pollSequenceRef.current += 1;
        setCalls(previous => {
            const current =
                callsRef.current.find(call => call.id === incoming.id) ??
                previous.find(call => call.id === incoming.id);
            const nextSnapshot = keepLatestNote(incoming, current);

            const index = previous.findIndex(call => call.id === incoming.id);
            const next =
                index < 0
                    ? [nextSnapshot, ...previous]
                    : previous.map(call => (call.id === incoming.id ? nextSnapshot : call));
            callsRef.current = next;
            return next;
        });
    }, []);

    const removeCall = useCallback((callId: string): void => {
        pollSequenceRef.current += 1;
        setCalls(previous => {
            const next = previous.filter(call => call.id !== callId);
            callsRef.current = next;
            return next;
        });
    }, []);

    const onNoteSaved = useCallback(
        (snapshot: CallSnapshot): void => {
            applySnapshot(snapshot, "mutation");
            onCallChangedRef.current?.();
        },
        [applySnapshot]
    );
    const { drafts, changeNote, changeTitle, saveNote, discardNote } = useCallNoteDrafts(
        calls,
        onNoteSaved
    );
    const onEnrichmentComplete = useCallback(
        (snapshot: CallSnapshot) => applySnapshot(snapshot, "mutation"),
        [applySnapshot]
    );
    const selectedMutation = selectedCallId ? mutations[selectedCallId] : undefined;
    const enrichmentPreview = useEnrichmentStream(
        calls.find(call => call.id === selectedCallId),
        selectedMutation?.phase === "pending" &&
            selectedMutation.request.kind === "request_enrichment",
        onEnrichmentComplete
    );

    useEffect(() => {
        let active = true;
        let pending: AbortController | undefined;
        const checkWorker = async () => {
            if (pending) return;
            const controller = new AbortController();
            pending = controller;
            const timeout = window.setTimeout(() => controller.abort(), 8_000);
            try {
                const response = await fetch("/api/call-notes/worker", {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error("Worker availability could not be checked");
                const worker = LocalCaptureWorkerStatusSchema.parse(await response.json());
                if (active)
                    setCaptureUnavailableReason(
                        worker.available
                            ? null
                            : "Local Capture Worker is offline. Start it on this Mac before starting Capture."
                    );
            } catch {
                if (active)
                    setCaptureUnavailableReason(
                        "Cannot reach the Local Capture Worker. Check the application and worker connection."
                    );
            } finally {
                window.clearTimeout(timeout);
                pending = undefined;
            }
        };
        void checkWorker();
        const interval = window.setInterval(() => void checkWorker(), 5_000);
        return () => {
            active = false;
            window.clearInterval(interval);
            pending?.abort();
        };
    }, []);

    const loadCalls = useCallback(async (): Promise<void> => {
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        const sequence = ++pollSequenceRef.current;
        const wasInitialLoad = initialLoadRef.current;
        try {
            const callsResponse = await fetch("/api/call-notes", {
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
            });
            const body: unknown = await callsResponse.json().catch(() => null);
            if (sequence !== pollSequenceRef.current) return;
            if (!callsResponse.ok) {
                throw new Error(commandErrorMessage(body, callsResponse.status));
            }
            const snapshots = CallSnapshotSchema.array().parse(body);
            if (selectedCallId && !snapshots.some(snapshot => snapshot.id === selectedCallId)) {
                const detailResponse = await fetch(
                    `/api/call-notes/${encodeURIComponent(selectedCallId)}`,
                    { cache: "no-store", signal: AbortSignal.timeout(10_000) }
                );
                if (detailResponse.ok) {
                    snapshots.push(CallSnapshotSchema.parse(await detailResponse.json()));
                }
            }
            if (sequence !== pollSequenceRef.current) return;
            for (const snapshot of snapshots) applySnapshot(snapshot, "poll");
            initialLoadRef.current = false;
            setStatus("ready");
            const selectedStillMissing =
                selectedCallId !== null &&
                detailFailedRef.current.has(selectedCallId) &&
                !callsRef.current.some(call => call.id === selectedCallId);
            if (!selectedStillMissing) setRefreshError(null);
        } catch (error) {
            if (sequence !== pollSequenceRef.current) return;
            const message =
                error instanceof Error ? error.message : "Call Notes could not be loaded";
            if (wasInitialLoad && callsRef.current.length === 0) {
                setStatus("failed");
            } else {
                setRefreshError(message);
            }
        } finally {
            pollInFlightRef.current = false;
        }
    }, [applySnapshot, selectedCallId]);

    useEffect(() => {
        void loadCalls();
        const interval = window.setInterval(() => void loadCalls(), 1_000);
        return () => window.clearInterval(interval);
    }, [loadCalls]);

    const selectedCallLoaded = selectedCallId
        ? calls.some(call => call.id === selectedCallId)
        : false;
    useEffect(() => {
        if (!selectedCallId || selectedCallLoaded) return;
        if (detailPendingRef.current.has(selectedCallId)) return;
        const lastRetry = detailRetrySeenRef.current.get(selectedCallId) ?? -1;
        if (detailFailedRef.current.has(selectedCallId) && detailRetry <= lastRetry) return;
        detailRetrySeenRef.current.set(selectedCallId, detailRetry);
        detailPendingRef.current.add(selectedCallId);
        let active = true;
        const sequence = pollSequenceRef.current;
        void (async () => {
            try {
                const response = await fetch(
                    `/api/call-notes/${encodeURIComponent(selectedCallId)}`,
                    { cache: "no-store" }
                );
                const body: unknown = await response.json().catch(() => null);
                if (!response.ok) throw new Error(commandErrorMessage(body, response.status));
                const snapshot = CallSnapshotSchema.parse(body);
                if (!active || sequence !== pollSequenceRef.current) return;
                detailFailedRef.current.delete(selectedCallId);
                detailRetrySeenRef.current.delete(selectedCallId);
                applySnapshot(snapshot, "detail");
                initialLoadRef.current = false;
                setStatus("ready");
                setRefreshError(null);
            } catch (error) {
                if (!active) return;
                detailFailedRef.current.add(selectedCallId);
                setRefreshError(
                    error instanceof Error
                        ? error.message
                        : "The selected Call Note could not be loaded"
                );
            } finally {
                detailPendingRef.current.delete(selectedCallId);
            }
        })();
        return () => {
            active = false;
        };
    }, [applySnapshot, detailRetry, selectedCallId, selectedCallLoaded]);

    const retryRefresh = useCallback(() => {
        detailFailedRef.current.clear();
        detailRetrySeenRef.current.clear();
        setRefreshError(null);
        setDetailRetry(value => value + 1);
        void loadCalls();
    }, [loadCalls]);

    const selectCall = useCallback(
        (callId: string | null) => {
            if (searchParams.get("feature") === "calls" && searchParams.get("call") === callId) {
                return;
            }
            const next = new URLSearchParams(searchParams.toString());
            next.set("feature", "calls");
            if (callId === null) next.delete("call");
            else next.set("call", callId);
            const query = next.toString();
            router.push(query ? `${pathname}?${query}` : pathname);
        },
        [pathname, router, searchParams]
    );

    const submitCapture = useCallback(
        async (request: CaptureCommandRequest): Promise<void> => {
            setCommand({ request, phase: "pending" });
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 15_000);
            try {
                const response = await fetch("/api/call-notes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ schemaVersion: "call-notes/v2", ...request }),
                    signal: controller.signal,
                });
                const body: unknown = await response.json().catch(() => null);
                if (!response.ok) throw new Error(commandErrorMessage(body, response.status));
                const snapshot = CallSnapshotSchema.parse(body);
                applySnapshot(snapshot, "mutation");
                setCommand(current =>
                    current?.request.requestId === request.requestId ? null : current
                );
                onCallChangedRef.current?.();
                if (
                    request.kind === "start_capture" &&
                    snapshot.status !== "failed" &&
                    snapshot.capture.lifecycle !== "failed"
                ) {
                    selectCall(snapshot.id);
                }
            } catch (error) {
                setCommand(current =>
                    current?.request.requestId === request.requestId
                        ? {
                              request,
                              phase: "failed",
                              error: controller.signal.aborted
                                  ? "Capture command timed out. Retry to check the same request safely."
                                  : error instanceof Error
                                    ? error.message
                                    : "Capture command failed",
                          }
                        : current
                );
            } finally {
                window.clearTimeout(timeout);
            }
        },
        [applySnapshot, selectCall]
    );

    const startCapture = useCallback(() => {
        if (command?.phase === "pending" || captureUnavailableReason) return;
        const nextRequestId = requestId();
        void submitCapture({
            kind: "start_capture",
            requestId: nextRequestId,
            sourceOccurrenceKey: `calls-ui-${nextRequestId}`,
        });
    }, [command, submitCapture, captureUnavailableReason]);

    const stopCapture = useCallback(
        (callId: string) => {
            if (command?.phase === "pending") return;
            void submitCapture({ kind: "stop_capture", requestId: requestId(), callId });
        },
        [command, submitCapture]
    );

    const retryCommand = useCallback(() => {
        if (command?.phase === "failed") void submitCapture(command.request);
    }, [command, submitCapture]);

    const submitMutation = useCallback(
        async (callId: string, request: CallMutationRequest): Promise<void> => {
            setMutations(previous => ({
                ...previous,
                [callId]: { request, phase: "pending" },
            }));
            try {
                const response = await fetch("/api/call-notes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ schemaVersion: "call-notes/v2", ...request }),
                });
                const body: unknown = await response.json().catch(() => null);
                if (!response.ok) throw new Error(commandErrorMessage(body, response.status));
                if (request.kind === "delete_call" && body === null) {
                    removeCall(callId);
                    setMutations(previous => {
                        const next = { ...previous };
                        if (next[callId]?.request.requestId === request.requestId)
                            delete next[callId];
                        return next;
                    });
                    if (selectedCallId === callId) selectCall(null);
                } else {
                    const snapshot = CallSnapshotSchema.parse(body);
                    applySnapshot(snapshot, "mutation");
                    setMutations(previous => {
                        const next = { ...previous };
                        if (next[callId]?.request.requestId === request.requestId)
                            delete next[callId];
                        return next;
                    });
                }
                onCallChangedRef.current?.();
            } catch (error) {
                setMutations(previous => {
                    if (previous[callId]?.request.requestId !== request.requestId) return previous;
                    return {
                        ...previous,
                        [callId]: {
                            request,
                            phase: "failed",
                            error:
                                error instanceof Error ? error.message : "Call Note command failed",
                        },
                    };
                });
            }
        },
        [applySnapshot, removeCall, selectCall, selectedCallId]
    );

    const mutationRequest = useCallback(
        (callId: string, request: CallMutationInput): void => {
            if (mutations[callId]?.phase === "pending") return;
            void submitMutation(callId, { ...request, requestId: requestId() });
        },
        [mutations, submitMutation]
    );

    const retryMutation = useCallback(
        (callId: string): void => {
            const current = mutations[callId];
            if (current?.phase === "failed") void submitMutation(callId, current.request);
        },
        [mutations, submitMutation]
    );

    const requestEnrichment = useCallback(
        (callId: string) => {
            const call = callsRef.current.find(snapshot => snapshot.id === callId);
            if (
                !call ||
                !call.viewerCapabilities.canRequestEnrichment ||
                drafts[callId] !== undefined
            )
                return;
            mutationRequest(callId, { kind: "request_enrichment", callId });
        },
        [drafts, mutationRequest]
    );
    const rejectEnrichment = useCallback(
        (callId: string, enrichmentRunId: string) => {
            const call = callsRef.current.find(snapshot => snapshot.id === callId);
            if (
                !call ||
                !call.viewerCapabilities.canResolveEnrichment ||
                call.enrichment?.id !== enrichmentRunId ||
                call.enrichment.status !== "ready"
            )
                return;
            mutationRequest(callId, { kind: "reject_enrichment", callId, enrichmentRunId });
        },
        [mutationRequest]
    );
    const acceptEnrichment = useCallback(
        (callId: string, enrichmentRunId: string, content: EditableContent) => {
            const call = callsRef.current.find(snapshot => snapshot.id === callId);
            if (
                !call ||
                !call.viewerCapabilities.canResolveEnrichment ||
                drafts[callId] !== undefined ||
                call.enrichment?.id !== enrichmentRunId ||
                call.enrichment.status !== "ready" ||
                !call.note ||
                call.enrichment.baseNoteRevision !== call.note.revision
            )
                return;
            mutationRequest(callId, {
                kind: "accept_enrichment",
                callId,
                enrichmentRunId,
                contentMarkdown: content.contentMarkdown,
                contentRich: content.contentRich,
            });
        },
        [drafts, mutationRequest]
    );

    const mutationStatus: Record<string, CallMutationStatus> = {};
    for (const [callId, value] of Object.entries(mutations)) {
        mutationStatus[callId] = { pending: value.phase === "pending", error: value.error };
    }

    if (status === "loading") {
        return (
            <div role="status" aria-live="polite" style={CENTERED_STATE_STYLE}>
                <div style={{ maxWidth: 520, textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Loading Calls…</p>
                    <p style={{ margin: "10px 0 0", color: "var(--ink-3)", lineHeight: 1.6 }}>
                        Start a capture when you are ready. Audio is handled by the configured local
                        worker; this page does not request browser microphone access.
                    </p>
                </div>
            </div>
        );
    }
    if (status === "failed") {
        return (
            <section aria-label="Calls unavailable" style={CENTERED_STATE_STYLE}>
                <div style={{ maxWidth: 560 }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>Calls are unavailable</h2>
                    <p style={{ margin: "12px 0 0", color: "var(--ink-3)", lineHeight: 1.6 }}>
                        Start and stop commands are sent to the configured local capture worker; no
                        browser microphone access is requested.
                    </p>
                    <p style={{ margin: "10px 0 0", color: "var(--ink-3)", lineHeight: 1.6 }}>
                        The Call Notes service could not be reached. Confirm the app, worker, and
                        CALL_NOTES_INTERNAL_TOKEN are configured, then retry.
                    </p>
                    <button
                        type="button"
                        onClick={retryRefresh}
                        style={{
                            marginTop: 18,
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            background: "var(--panel)",
                            color: "var(--ink)",
                            padding: "8px 14px",
                            cursor: "pointer",
                        }}
                    >
                        Retry
                    </button>
                </div>
            </section>
        );
    }

    const pendingCommand: CaptureCommand | null =
        command?.phase === "pending"
            ? command.request.kind === "start_capture"
                ? "start"
                : "stop"
            : null;
    const commandError =
        command?.phase === "failed" ? (command.error ?? "Capture command failed") : null;

    return (
        <CallsWorkspace
            calls={calls}
            initialSelectedId={selectedCallId}
            pendingCommand={pendingCommand}
            captureUnavailableReason={captureUnavailableReason}
            commandError={commandError}
            onRetryCommand={commandError ? retryCommand : undefined}
            refreshError={refreshError}
            onRetryRefresh={retryRefresh}
            mutationStatus={mutationStatus}
            onRetryMutation={retryMutation}
            onStartCapture={startCapture}
            onStopCapture={stopCapture}
            onSelectCall={selectCall}
            noteDrafts={drafts}
            enrichmentPreview={enrichmentPreview}
            onNoteChange={changeNote}
            onNoteTitleChange={changeTitle}
            onSaveNote={saveNote}
            onDiscardNote={discardNote}
            onSetVisibility={(callId, visibility) =>
                mutationRequest(callId, { kind: "set_note_visibility", callId, visibility })
            }
            onRequestEnrichment={requestEnrichment}
            onRejectEnrichment={rejectEnrichment}
            onAcceptEnrichment={acceptEnrichment}
            onDeleteCall={callId => {
                const call = callsRef.current.find(snapshot => snapshot.id === callId);
                if (!call?.viewerCapabilities.canDelete) return;
                mutationRequest(callId, { kind: "delete_call", callId });
            }}
        />
    );
}
