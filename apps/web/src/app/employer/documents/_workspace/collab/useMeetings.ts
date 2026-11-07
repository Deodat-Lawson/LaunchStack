"use client";

/**
 * Data hooks for the meetings surface.
 *
 * Transcript updates arrive by polling `?afterSeq=`, which returns only the
 * tail. Polling — rather than a socket — because a meeting is turn-based and
 * bursty: nothing happens for seconds at a time, then one message lands. The
 * interval tightens while a meeting is live and stops entirely once it ends,
 * so an open-but-finished meeting costs nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useAgentCopy } from "~/lib/agents/i18n";
import { meetingWorkflow } from "~/lib/agents/meeting-workflows";

import type {
    AgentsResponse,
    ChannelMessage,
    MeetingDetail,
    MeetingState,
    MeetingSummary,
} from "./types";

const LIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;
/** Turns one `run` request may take; the loop issues as many as it needs. */
const RUN_BATCH = 3;

/** Reads a JSON response; a failure throws the server's error, or `failed(status)` without one. */
async function readJson<T>(response: Response, failed: (status: number) => string): Promise<T> {
    const text = await response.text();
    const parsed = text
        ? (JSON.parse(text) as T & { error?: string })
        : ({} as T & { error?: string });
    if (!response.ok) throw new Error(parsed.error ?? failed(response.status));
    return parsed;
}

type ErrorsTranslator = ReturnType<typeof useTranslations<"collab.errors">>;

function requestFailed(t: ErrorsTranslator) {
    return (status: number) => t("requestFailed", { status });
}

export function useMeetingList() {
    const t = useTranslations("collab.errors");
    const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const data = await readJson<{ meetings: MeetingSummary[] }>(
                await fetch("/api/collab/meetings"),
                requestFailed(t)
            );
            setMeetings(data.meetings);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadMeetings"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { meetings, loading, error, refresh };
}

/**
 * The roster. One fetch per mount; `refresh` after an edit. Pass
 * `includeArchived` for the Agents page, which offers retired agents a way
 * back.
 */
export function useAgents(options: { includeArchived?: boolean } = {}) {
    const { includeArchived = false } = options;
    const t = useTranslations("collab.errors");
    const [data, setData] = useState<AgentsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setData(
                await readJson<AgentsResponse>(
                    await fetch(
                        includeArchived ? "/api/collab/agents?archived=1" : "/api/collab/agents"
                    ),
                    requestFailed(t)
                )
            );
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadAgents"));
        } finally {
            setLoading(false);
        }
    }, [includeArchived, t]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { data, loading, error, refresh };
}

export interface MeetingController {
    detail: MeetingDetail["meeting"] | null;
    state: MeetingState | null;
    messages: ChannelMessage[];
    minutes: MeetingDetail["minutes"] | null;
    loading: boolean;
    error: string | null;
    busy: string | null;
    control: (action: ControlAction, options?: ControlOptions) => Promise<void>;
    /**
     * Keep taking turns until the meeting ends, pauses, or a person takes the
     * floor. Each request is bounded; the loop is what makes the room run on
     * its own from the reader's point of view.
     */
    runUntilDone: () => Promise<void>;
    /** Stops the run loop after the request in flight returns. */
    stopRunning: () => void;
    running: boolean;
    postMessage: (text: string, asPersonaId?: string) => Promise<void>;
    reload: () => Promise<void>;
}

export type ControlAction =
    | "start"
    | "step"
    | "run"
    | "pause"
    | "resume"
    | "takeover"
    | "release"
    | "complete";

export interface ControlOptions {
    limit?: number;
    asPersonaId?: string;
    reason?: string;
}

function isTerminal(status: MeetingState["status"]): boolean {
    return status === "completed" || status === "failed";
}

export function useMeeting(meetingId: string | null): MeetingController {
    const t = useTranslations("collab.errors");
    const [detail, setDetail] = useState<MeetingDetail["meeting"] | null>(null);
    const [state, setState] = useState<MeetingState | null>(null);
    const [messages, setMessages] = useState<ChannelMessage[]>([]);
    const [minutes, setMinutes] = useState<MeetingDetail["minutes"] | null>(null);
    const [loading, setLoading] = useState(Boolean(meetingId));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [running, setRunning] = useState(false);

    const seqRef = useRef(0);
    const activeId = useRef<string | null>(null);
    const runLoop = useRef<{ meetingId: string; cancelled: boolean } | null>(null);

    const load = useCallback(
        async (afterSeq: number) => {
            if (!meetingId) return;
            const data = await readJson<MeetingDetail>(
                await fetch(`/api/collab/meetings/${meetingId}?afterSeq=${afterSeq}`),
                requestFailed(t)
            );
            // A late response from a meeting the user has already navigated away
            // from must not overwrite the one now on screen.
            if (activeId.current !== meetingId) return;

            setDetail(data.meeting);
            setState(data.state);
            setMinutes(data.minutes);
            setMessages(prev => {
                if (afterSeq === 0) return data.messages;
                if (data.messages.length === 0) return prev;
                const known = new Set(prev.map(m => m.id));
                return [...prev, ...data.messages.filter(m => !known.has(m.id))];
            });
            seqRef.current = Math.max(data.latestSeq, afterSeq);
        },
        [meetingId, t]
    );

    const reload = useCallback(async () => {
        if (!meetingId) return;
        setLoading(true);
        try {
            await load(0);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadMeeting"));
        } finally {
            setLoading(false);
        }
    }, [load, meetingId, t]);

    useEffect(() => {
        activeId.current = meetingId;
        seqRef.current = 0;
        // Leaving a room stops driving it; the meeting keeps its state server-side.
        if (runLoop.current) runLoop.current.cancelled = true;
        runLoop.current = null;
        setRunning(false);
        setMessages([]);
        setDetail(null);
        setState(null);
        setMinutes(null);
        if (!meetingId) {
            setLoading(false);
            return;
        }
        void reload();
    }, [meetingId, reload]);

    // Poll for the tail while the meeting can still change.
    useEffect(() => {
        if (!meetingId || !state) return;
        if (isTerminal(state.status)) return;

        const interval = state.status === "running" ? LIVE_POLL_MS : IDLE_POLL_MS;
        const timer = setInterval(() => {
            void load(seqRef.current).catch(() => undefined);
        }, interval);
        return () => clearInterval(timer);
    }, [meetingId, state, load]);

    const sendControl = useCallback(
        async (action: ControlAction, options: ControlOptions = {}): Promise<MeetingState> => {
            if (!meetingId) throw new Error(t("noMeetingSelected"));
            const data = await readJson<{ state: MeetingState }>(
                await fetch(`/api/collab/meetings/${meetingId}/control`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action, ...options }),
                }),
                requestFailed(t)
            );
            if (activeId.current === meetingId) setState(data.state);
            await load(seqRef.current);
            return data.state;
        },
        [meetingId, load, t]
    );

    const control = useCallback(
        async (action: ControlAction, options: ControlOptions = {}) => {
            if (!meetingId) return;
            // Pausing, taking over or ending should also stop the loop that
            // would otherwise immediately ask for more turns.
            if (action !== "run" && action !== "step" && runLoop.current) {
                runLoop.current.cancelled = true;
            }
            setBusy(action);
            setError(null);
            try {
                await sendControl(action, options);
            } catch (err) {
                setError(err instanceof Error ? err.message : t("control", { action }));
            } finally {
                setBusy(null);
            }
        },
        [meetingId, sendControl, t]
    );

    const stopRunning = useCallback(() => {
        if (runLoop.current) runLoop.current.cancelled = true;
    }, []);

    const runUntilDone = useCallback(async () => {
        if (!meetingId || runLoop.current) return;
        const loop = { meetingId, cancelled: false };
        runLoop.current = loop;
        setRunning(true);
        setBusy("run");
        setError(null);
        try {
            for (;;) {
                const next = await sendControl("run", { limit: RUN_BATCH });
                if (loop.cancelled || activeId.current !== meetingId) break;
                if (isTerminal(next.status) || next.status !== "running") break;
            }
        } catch (err) {
            if (!loop.cancelled) {
                setError(err instanceof Error ? err.message : t("stoppedUnexpectedly"));
            }
        } finally {
            if (runLoop.current === loop) runLoop.current = null;
            if (activeId.current === meetingId) {
                setRunning(false);
                setBusy(null);
            }
        }
    }, [meetingId, sendControl, t]);

    const postMessage = useCallback(
        async (text: string, asPersonaId?: string) => {
            if (!meetingId || !text.trim()) return;
            setBusy("post");
            setError(null);
            try {
                await readJson<{ message: ChannelMessage; state: MeetingState }>(
                    await fetch(`/api/collab/meetings/${meetingId}/messages`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text, asPersonaId }),
                    }),
                    requestFailed(t)
                );
                await load(seqRef.current);
            } catch (err) {
                setError(err instanceof Error ? err.message : t("postFailed"));
            } finally {
                setBusy(null);
            }
        },
        [meetingId, load, t]
    );

    return {
        detail,
        state,
        messages,
        minutes,
        loading,
        error,
        busy,
        control,
        runUntilDone,
        stopRunning,
        running,
        postMessage,
        reload,
    };
}

// ---------------------------------------------------------------------------
// Display helpers the collab screens share
// ---------------------------------------------------------------------------

/**
 * A meeting's workflow title in the reader's language. The meeting stores
 * the template's English title; one still matching its template reads from
 * the catalogue, anything else (an older template, a custom title) as stored.
 */
export function useWorkflowTitle(): (
    workflowKey: string | null | undefined,
    title: string | null | undefined
) => string | null {
    const copy = useAgentCopy();
    return (workflowKey, title) => {
        if (!title) return null;
        const workflow = meetingWorkflow(workflowKey);
        return workflow && workflow.title === title ? copy.workflowCopy(workflow).title : title;
    };
}

/**
 * "3m ago" for something that happened recently; past `dateAfterDays` it
 * becomes a short date ("Mar 4"). `null` means it never happened.
 */
export function useAgo(): (
    at: number | string | null | undefined,
    options?: { seconds?: boolean; dateAfterDays?: number }
) => string {
    const t = useTranslations("collab.time");
    const tc = useTranslations("common.time");
    const format = useFormatter();
    return (at, options = {}) => {
        const then = typeof at === "string" ? new Date(at).getTime() : (at ?? 0);
        if (!then || !Number.isFinite(then)) return typeof at === "string" ? "" : t("never");
        const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (options.seconds) {
            if (seconds < 60) return t("secondsAgo", { count: seconds });
            if (seconds < 3600) return t("minutesAgo", { count: Math.round(seconds / 60) });
            if (seconds < 86_400) return t("hoursAgo", { count: Math.round(seconds / 3600) });
            return t("daysAgo", { count: Math.round(seconds / 86_400) });
        }
        const minutes = Math.round(seconds / 60);
        if (minutes < 1) return tc("justNow");
        if (minutes < 60) return t("minutesAgo", { count: minutes });
        const hours = Math.round(minutes / 60);
        if (hours < 24) return t("hoursAgo", { count: hours });
        const days = Math.round(hours / 24);
        if (days < (options.dateAfterDays ?? Infinity)) return t("daysAgo", { count: days });
        return format.dateTime(new Date(then), { month: "short", day: "numeric" });
    };
}
