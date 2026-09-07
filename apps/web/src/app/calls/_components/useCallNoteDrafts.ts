"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
    CallSnapshotSchema,
    type CallNote,
    type CallSnapshot,
} from "@launchstack/features/call-notes/contracts";

const AUTOSAVE_DELAY_MS = 600;

export type CallNoteDraft = {
    title: string;
    contentRich: CallNote["contentRich"];
    contentMarkdown: string;
    baseRevision: number;
    status: "unsaved" | "saving" | "failed" | "conflict";
    error?: string;
};

type NoteContent = Pick<CallNote, "contentRich" | "contentMarkdown">;
type DraftContent = NoteContent & { title?: string };

type SaveAttempt = {
    callId: string;
    baseRevision: number;
    title: string;
    contentRich: CallNote["contentRich"];
    contentMarkdown: string;
    body: string;
    discarded: boolean;
    highestPolledRevision: number;
};

type SaveFailure = {
    message: string;
    status?: number;
};

type EditableCallSnapshot = CallSnapshot & {
    note: NonNullable<CallSnapshot["note"]>;
};

function editableCall(calls: readonly CallSnapshot[], callId: string): EditableCallSnapshot | null {
    const call = calls.find(snapshot => snapshot.id === callId);
    if (!call || !call.viewerCapabilities.canEditNote || call.note === null) return null;
    return { ...call, note: call.note };
}

function richTextSignature(contentRich: CallNote["contentRich"]): string {
    return JSON.stringify(contentRich) ?? "undefined";
}

function sameContent(left: DraftContent, right: DraftContent): boolean {
    return (
        (left.title === undefined || right.title === undefined || left.title === right.title) &&
        left.contentMarkdown === right.contentMarkdown &&
        richTextSignature(left.contentRich) === richTextSignature(right.contentRich)
    );
}

function requestId(): string {
    return crypto.randomUUID();
}
function responseErrorMessage(body: unknown, status: number): string {
    if (body && typeof body === "object") {
        if ("error" in body && typeof body.error === "string" && body.error.length > 0) {
            return body.error;
        }
        if ("message" in body && typeof body.message === "string" && body.message.length > 0) {
            return body.message;
        }
    }
    return `Call Note save failed (HTTP ${status})`;
}

function networkErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Call Note save failed. Check your connection and retry.";
}

/**
 * Keeps per-call editor drafts separate from the polling snapshot stream.
 *
 * A draft is intentionally retained until the server acknowledges that exact
 * content or the caller explicitly discards it. Failed requests retain their
 * serialized command so an explicit retry can reuse the same idempotency key
 * and payload, including when the original response was ambiguous.
 */
export function useCallNoteDrafts(
    calls: CallSnapshot[],
    onSaved: (snapshot: CallSnapshot) => void
): {
    drafts: Readonly<Record<string, CallNoteDraft>>;
    changeNote: (callId: string, content: NoteContent) => void;
    changeTitle: (callId: string, title: string) => void;
    saveNote: (callId: string) => void;
    discardNote: (callId: string) => void;
} {
    const [drafts, setDrafts] = useState<Record<string, CallNoteDraft>>({});
    const draftsRef = useRef<Record<string, CallNoteDraft>>({});
    const callsRef = useRef<CallSnapshot[]>(calls);
    const onSavedRef = useRef(onSaved);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const inFlightRef = useRef<Map<string, SaveAttempt>>(new Map());
    const retryAttemptsRef = useRef<Map<string, SaveAttempt>>(new Map());
    const mountedRef = useRef(false);
    const startSaveRef = useRef<(callId: string, explicit: boolean) => void>(() => undefined);

    callsRef.current = calls;
    onSavedRef.current = onSaved;

    const publishDrafts = useCallback((next: Record<string, CallNoteDraft>): void => {
        draftsRef.current = next;
        if (mountedRef.current) setDrafts(next);
    }, []);

    const updateDraft = useCallback(
        (callId: string, draft: CallNoteDraft | undefined): void => {
            const current = draftsRef.current;
            const next = { ...current };
            if (draft === undefined) delete next[callId];
            else next[callId] = draft;
            publishDrafts(next);
        },
        [publishDrafts]
    );

    const clearTimer = useCallback((callId: string): void => {
        const timer = timersRef.current.get(callId);
        if (timer !== undefined) {
            clearTimeout(timer);
            timersRef.current.delete(callId);
        }
    }, []);

    const scheduleAutosave = useCallback(
        (callId: string): void => {
            clearTimer(callId);
            const timer = setTimeout(() => {
                timersRef.current.delete(callId);
                startSaveRef.current(callId, false);
            }, AUTOSAVE_DELAY_MS);
            timersRef.current.set(callId, timer);
        },
        [clearTimer]
    );

    const handleSaveFailure = useCallback(
        (attempt: SaveAttempt, failure: SaveFailure): void => {
            inFlightRef.current.delete(attempt.callId);
            const currentDraft = draftsRef.current[attempt.callId];

            if (attempt.discarded) {
                // A submitted request cannot be cancelled. If it failed after
                // discard, there is no local content to expose or retry. A
                // newer draft created while that request was pending is still
                // independent and should get its own debounce.
                if (currentDraft === undefined) {
                    retryAttemptsRef.current.delete(attempt.callId);
                } else if (currentDraft.status === "unsaved") {
                    scheduleAutosave(attempt.callId);
                }
                return;
            }

            retryAttemptsRef.current.set(attempt.callId, attempt);
            if (currentDraft === undefined) return;

            updateDraft(attempt.callId, {
                ...currentDraft,
                status: failure.status === 409 ? "conflict" : "failed",
                error: failure.message,
            });
        },
        [scheduleAutosave, updateDraft]
    );
    const handleSaveSuccess = useCallback(
        (attempt: SaveAttempt, snapshot: CallSnapshot): void => {
            inFlightRef.current.delete(attempt.callId);
            retryAttemptsRef.current.delete(attempt.callId);

            const currentDraft = draftsRef.current[attempt.callId];
            const contentStillMatches =
                currentDraft !== undefined &&
                currentDraft.baseRevision === attempt.baseRevision &&
                sameContent(currentDraft, attempt);

            if (currentDraft === undefined || contentStillMatches) {
                if (currentDraft !== undefined) updateDraft(attempt.callId, undefined);
            } else if (snapshot.note === null) {
                updateDraft(attempt.callId, {
                    ...currentDraft,
                    status: "failed",
                    error: "Call Note save returned no editable Note revision.",
                });
                return;
            } else {
                const expectedRevision = attempt.baseRevision + 1;
                const observedRevision = Math.max(
                    snapshot.note.revision,
                    attempt.highestPolledRevision
                );
                if (observedRevision !== expectedRevision) {
                    updateDraft(attempt.callId, {
                        ...currentDraft,
                        status: "conflict",
                        error: "The Call Note changed while your edit was saving. Review it before retrying.",
                    });
                    return;
                }

                // The editor kept accepting input while this request was in
                // flight. The acknowledged revision is the new base for that
                // newer local content; do not replace its text with the reply.
                updateDraft(attempt.callId, {
                    ...currentDraft,
                    baseRevision: expectedRevision,
                    status: "unsaved",
                    error: undefined,
                });
                if (mountedRef.current) scheduleAutosave(attempt.callId);
                else startSaveRef.current(attempt.callId, false);
            }

            if (mountedRef.current && snapshot.note !== null) {
                onSavedRef.current(snapshot);
            }
        },
        [scheduleAutosave, updateDraft]
    );

    const submitAttempt = useCallback(
        (attempt: SaveAttempt): void => {
            void (async () => {
                let snapshot: CallSnapshot;
                try {
                    const response = await fetch("/api/call-notes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: attempt.body,
                    });
                    const body: unknown = await response.json().catch(() => null);
                    if (!response.ok) {
                        handleSaveFailure(attempt, {
                            message: responseErrorMessage(body, response.status),
                            status: response.status,
                        });
                        return;
                    }

                    try {
                        snapshot = CallSnapshotSchema.parse(body);
                    } catch {
                        handleSaveFailure(attempt, {
                            message: "Call Note save returned an invalid Call snapshot.",
                        });
                        return;
                    }
                    if (snapshot.id !== attempt.callId) {
                        handleSaveFailure(attempt, {
                            message: "Call Note save returned a snapshot for the wrong call.",
                        });
                        return;
                    }
                    if (snapshot.note === null) {
                        handleSaveFailure(attempt, {
                            message: "Call Note save returned no editable Note.",
                        });
                        return;
                    }
                } catch (error) {
                    handleSaveFailure(attempt, { message: networkErrorMessage(error) });
                    return;
                }

                // Keep parent callback errors outside the transport failure
                // boundary: an acknowledged write must not be retried as if
                // fetch itself failed.
                handleSaveSuccess(attempt, snapshot);
            })();
        },
        [handleSaveFailure, handleSaveSuccess]
    );

    const startSave = useCallback(
        (callId: string, explicit: boolean): void => {
            if (inFlightRef.current.has(callId)) return;

            const call = editableCall(callsRef.current, callId);
            const currentDraft = draftsRef.current[callId];
            if (!call || currentDraft === undefined) return;
            if (!explicit && currentDraft.status !== "unsaved") return;

            clearTimer(callId);
            const retry = retryAttemptsRef.current.get(callId);
            let attempt: SaveAttempt;
            if (retry !== undefined) {
                // An unresolved attempt may have committed even when its
                // response was lost. Retry that exact serialized command
                // before sending newer local text.
                attempt = retry;
            } else {
                const nextRequestId = requestId();
                const body = {
                    schemaVersion: "call-notes/v2" as const,
                    kind: "update_note" as const,
                    requestId: nextRequestId,
                    callId,
                    baseRevision: currentDraft.baseRevision,
                    title: currentDraft.title,
                    contentRich: currentDraft.contentRich,
                    contentMarkdown: currentDraft.contentMarkdown,
                };
                let serializedBody: string;
                try {
                    serializedBody = JSON.stringify(body);
                } catch {
                    updateDraft(callId, {
                        ...currentDraft,
                        status: "failed",
                        error: "Call Note content could not be serialized. Edit it and retry.",
                    });
                    return;
                }
                attempt = {
                    callId,
                    baseRevision: currentDraft.baseRevision,
                    title: currentDraft.title,
                    contentRich: currentDraft.contentRich,
                    contentMarkdown: currentDraft.contentMarkdown,
                    body: serializedBody,
                    discarded: false,
                    highestPolledRevision: currentDraft.baseRevision,
                };
            }

            attempt.discarded = false;
            retryAttemptsRef.current.delete(callId);
            inFlightRef.current.set(callId, attempt);
            updateDraft(callId, { ...currentDraft, status: "saving", error: undefined });
            submitAttempt(attempt);
        },
        [clearTimer, submitAttempt, updateDraft]
    );

    startSaveRef.current = startSave;

    const changeNote = useCallback(
        (callId: string, content: NoteContent): void => {
            const call = editableCall(callsRef.current, callId);
            if (!call) return;

            const currentDraft = draftsRef.current[callId];
            if (currentDraft !== undefined && sameContent(currentDraft, content)) return;

            const nextDraft: CallNoteDraft =
                currentDraft === undefined
                    ? {
                          title: call.note.title,
                          contentRich: content.contentRich,
                          contentMarkdown: content.contentMarkdown,
                          baseRevision: call.note.revision,
                          status: "unsaved",
                      }
                    : {
                          ...currentDraft,
                          contentRich: content.contentRich,
                          contentMarkdown: content.contentMarkdown,
                      };
            updateDraft(callId, nextDraft);

            // A failed/conflicted draft is deliberately held for explicit
            // retry. New text remains visible but does not restart autosave.
            if (nextDraft.status === "unsaved") scheduleAutosave(callId);
        },
        [scheduleAutosave, updateDraft]
    );

    const changeTitle = useCallback(
        (callId: string, title: string): void => {
            const call = editableCall(callsRef.current, callId);
            if (!call) return;

            const currentDraft = draftsRef.current[callId];
            if (currentDraft !== undefined && currentDraft.title === title) return;

            const nextDraft: CallNoteDraft =
                currentDraft === undefined
                    ? {
                          title,
                          contentRich: call.note.contentRich,
                          contentMarkdown: call.note.contentMarkdown,
                          baseRevision: call.note.revision,
                          status: "unsaved",
                      }
                    : { ...currentDraft, title };
            updateDraft(callId, nextDraft);
            if (nextDraft.status === "unsaved") scheduleAutosave(callId);
        },
        [scheduleAutosave, updateDraft]
    );

    const saveNote = useCallback((callId: string): void => {
        startSaveRef.current(callId, true);
    }, []);

    const discardNote = useCallback(
        (callId: string): void => {
            clearTimer(callId);
            const inFlight = inFlightRef.current.get(callId);
            if (inFlight) inFlight.discarded = true;
            retryAttemptsRef.current.delete(callId);
            updateDraft(callId, undefined);
        },
        [clearTimer, updateDraft]
    );

    useEffect(() => {
        mountedRef.current = true;
        const timers = timersRef.current;

        const beforeUnload = (event: BeforeUnloadEvent): void => {
            if (Object.keys(draftsRef.current).length === 0) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", beforeUnload);

        return () => {
            mountedRef.current = false;
            window.removeEventListener("beforeunload", beforeUnload);

            for (const [callId, timer] of timers) {
                clearTimeout(timer);
                timers.delete(callId);
            }
            for (const [callId, draft] of Object.entries(draftsRef.current)) {
                if (draft.status === "unsaved") startSaveRef.current(callId, false);
            }
        };
    }, []);

    useEffect(() => {
        const nextDrafts = { ...draftsRef.current };
        let changed = false;

        for (const call of calls) {
            const draft = nextDrafts[call.id];
            if (draft === undefined || !call.viewerCapabilities.canEditNote || call.note === null) {
                continue;
            }

            const inFlight = inFlightRef.current.get(call.id);
            if (inFlight !== undefined) {
                inFlight.highestPolledRevision = Math.max(
                    inFlight.highestPolledRevision,
                    call.note.revision
                );
                continue;
            }

            if (call.note.revision > draft.baseRevision) {
                clearTimer(call.id);
                nextDrafts[call.id] = {
                    ...draft,
                    status: "conflict",
                    error: "This Call Note changed on the server. Review it before retrying.",
                };
                changed = true;
                continue;
            }

            if (draft.status === "unsaved" && !timersRef.current.has(call.id)) {
                // A temporary poll omission may have fired the original timer
                // while this call was absent. Resume the same draft once the
                // editable snapshot is present again, without resetting an
                // already-running debounce on every poll.
                scheduleAutosave(call.id);
            }
        }

        if (changed) publishDrafts(nextDrafts);
    }, [calls, clearTimer, publishDrafts, scheduleAutosave]);
    // A redacted/read-only snapshot must never cause a local Note body to be
    // rendered. Keep its internal draft until explicit discard so a transient
    // poll cannot destroy user input, but expose drafts only for editable calls.
    const visibleDrafts: Record<string, CallNoteDraft> = {};
    for (const [callId, draft] of Object.entries(drafts)) {
        if (editableCall(calls, callId)) visibleDrafts[callId] = draft;
    }

    return { drafts: visibleDrafts, changeNote, changeTitle, saveNote, discardNote };
}
