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

import type {
  AgentsResponse,
  ChannelMessage,
  MeetingDetail,
  MeetingState,
  MeetingSummary,
} from "./types";

const LIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) throw new Error(parsed.error ?? `Request failed (${response.status})`);
  return parsed;
}

export function useMeetingList() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await readJson<{ meetings: MeetingSummary[] }>(await fetch("/api/collab/meetings"));
      setMeetings(data.meetings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load meetings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { meetings, loading, error, refresh };
}

export function useAgents() {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await readJson<AgentsResponse>(await fetch("/api/collab/agents")));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agents");
    } finally {
      setLoading(false);
    }
  }, []);

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

export function useMeeting(meetingId: string | null): MeetingController {
  const [detail, setDetail] = useState<MeetingDetail["meeting"] | null>(null);
  const [state, setState] = useState<MeetingState | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [minutes, setMinutes] = useState<MeetingDetail["minutes"] | null>(null);
  const [loading, setLoading] = useState(Boolean(meetingId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const seqRef = useRef(0);
  const activeId = useRef<string | null>(null);

  const load = useCallback(
    async (afterSeq: number) => {
      if (!meetingId) return;
      const data = await readJson<MeetingDetail>(
        await fetch(`/api/collab/meetings/${meetingId}?afterSeq=${afterSeq}`),
      );
      // A late response from a meeting the user has already navigated away
      // from must not overwrite the one now on screen.
      if (activeId.current !== meetingId) return;

      setDetail(data.meeting);
      setState(data.state);
      setMinutes(data.minutes);
      setMessages((prev) => {
        if (afterSeq === 0) return data.messages;
        if (data.messages.length === 0) return prev;
        const known = new Set(prev.map((m) => m.id));
        return [...prev, ...data.messages.filter((m) => !known.has(m.id))];
      });
      seqRef.current = Math.max(data.latestSeq, afterSeq);
    },
    [meetingId],
  );

  const reload = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    try {
      await load(0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the meeting");
    } finally {
      setLoading(false);
    }
  }, [load, meetingId]);

  useEffect(() => {
    activeId.current = meetingId;
    seqRef.current = 0;
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
    if (state.status === "completed" || state.status === "failed") return;

    const interval = state.status === "running" ? LIVE_POLL_MS : IDLE_POLL_MS;
    const timer = setInterval(() => {
      void load(seqRef.current).catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [meetingId, state, load]);

  const control = useCallback(
    async (action: ControlAction, options: ControlOptions = {}) => {
      if (!meetingId) return;
      setBusy(action);
      setError(null);
      try {
        const data = await readJson<{ state: MeetingState }>(
          await fetch(`/api/collab/meetings/${meetingId}/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...options }),
          }),
        );
        setState(data.state);
        await load(seqRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not ${action} the meeting`);
      } finally {
        setBusy(null);
      }
    },
    [meetingId, load],
  );

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
        );
        await load(seqRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post the message");
      } finally {
        setBusy(null);
      }
    },
    [meetingId, load],
  );

  return { detail, state, messages, minutes, loading, error, busy, control, postMessage, reload };
}
