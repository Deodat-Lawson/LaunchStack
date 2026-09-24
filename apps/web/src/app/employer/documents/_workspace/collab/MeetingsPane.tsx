"use client";

/**
 * Meetings — a Slack-shaped channel where the participants happen to be
 * agents, and any human can step in.
 *
 * The layout is deliberately a channel and not a "meeting room": a channel
 * list on the left, one scrolling transcript in the middle, and the meeting's
 * controls in the header. That is the whole point of the feature — a meeting
 * is a conversation in a channel, mirrored to Slack when configured, and the
 * human is a participant rather than an observer of a black box.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, ListChecks, Square, Workflow, Zap } from "lucide-react";

import { cn } from "~/lib/utils";

import {
    IconBroadcast,
    IconCheck,
    IconClock,
    IconHand,
    IconHash,
    IconPause,
    IconPlay,
    IconPlus,
    IconRobot,
    IconServer,
    IconSlack,
    IconStop,
    IconUser,
    IconX,
} from "../icons";
import { AgentAvatar } from "./AgentAvatar";
import { MeetingsHome } from "./MeetingsHome";
import { NewMeetingDialog } from "./NewMeetingDialog";
import { useAgents, useMeeting, useMeetingList, type ControlAction } from "./useMeetings";
import {
    initialsOf,
    MEETING_STATUS_META,
    personaColor,
    statusColor,
    type ChannelMessage,
    type MeetingParticipant,
    type MeetingPhase,
    type MeetingSummary,
} from "./types";

export interface MeetingsPaneProps {
    /** Rendered inside the workspace main area rather than as a standalone page. */
    embedded?: boolean;
    /** Opens the Agents app — a Studio move the shell makes, when hosted there. */
    onOpenAgents?: () => void;
    /**
     * A request from elsewhere (the Agents app's "Put in a meeting") to open
     * the new-meeting dialog. The nonce makes repeat requests distinct.
     */
    newMeetingRequest?: { workflowKey?: string | null; seats?: string[]; nonce: number } | null;
}

export function MeetingsPane({ onOpenAgents, newMeetingRequest }: MeetingsPaneProps = {}) {
    const { meetings, loading: listLoading, error: listError, refresh } = useMeetingList();
    const roster = useAgents();
    // `null` is the dashboard. The pane lands there on purpose: the old
    // behaviour of jumping into the most recent channel is what made the
    // feature read as "a chat I did not start".
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState<{
        workflowKey: string | null;
        seats?: string[];
    } | null>(null);

    useEffect(() => {
        if (newMeetingRequest) {
            setCreating({
                workflowKey: newMeetingRequest.workflowKey ?? null,
                seats: newMeetingRequest.seats,
            });
        }
    }, [newMeetingRequest]);

    const meeting = useMeeting(selectedId);

    const handleCreated = useCallback(
        async (meetingId: string) => {
            setCreating(null);
            await refresh();
            setSelectedId(meetingId);
        },
        [refresh]
    );

    const agents = useMemo(
        () => roster.data?.personas.filter(p => !p.archived) ?? [],
        [roster.data]
    );

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg)" }}>
            <ChannelList
                meetings={meetings}
                loading={listLoading}
                error={listError}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onHome={() => setSelectedId(null)}
                onNew={() => setCreating({ workflowKey: null })}
            />

            {selectedId ? (
                <ChannelView key={selectedId} controller={meeting} onEnded={() => void refresh()} />
            ) : (
                <MeetingsHome
                    meetings={meetings}
                    agents={agents}
                    loading={listLoading || roster.loading}
                    onStart={workflowKey => setCreating({ workflowKey: workflowKey ?? null })}
                    onOpen={setSelectedId}
                    onManageAgents={onOpenAgents}
                />
            )}

            <NewMeetingDialog
                open={creating !== null}
                initialWorkflowKey={creating?.workflowKey ?? null}
                initialSeats={creating?.seats ?? null}
                onClose={() => setCreating(null)}
                onCreated={id => void handleCreated(id)}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Channel list
// ---------------------------------------------------------------------------

function ChannelList({
    meetings,
    loading,
    error,
    selectedId,
    onSelect,
    onHome,
    onNew,
}: {
    meetings: MeetingSummary[];
    loading: boolean;
    error: string | null;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onHome: () => void;
    onNew: () => void;
}) {
    const live = meetings.filter(m => m.status === "running" || m.status === "human_control");
    const other = meetings.filter(m => !live.includes(m));

    return (
        <aside
            style={{
                width: 268,
                flexShrink: 0,
                borderRight: "1px solid var(--line)",
                background: "var(--panel)",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
            }}
        >
            <div
                style={{
                    padding: "14px 16px 12px",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        className="mono"
                        style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "var(--ink-3)",
                        }}
                    >
                        Channels
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                        {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
                    </div>
                </div>
                <button
                    onClick={onNew}
                    title="New meeting"
                    aria-label="New meeting"
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: "1px solid var(--line)",
                        background: "var(--panel-2)",
                        color: "var(--ink-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--line)";
                        e.currentTarget.style.color = "var(--ink-2)";
                    }}
                >
                    <IconPlus size={14} />
                </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px", minHeight: 0 }}>
                <button
                    type="button"
                    onClick={onHome}
                    aria-current={selectedId === null ? "page" : undefined}
                    className={cn(
                        "mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors",
                        selectedId === null
                            ? "bg-brand-soft text-brand-ink font-semibold"
                            : "text-ink-2 hover:bg-line-2"
                    )}
                >
                    <Home className="size-3.5 shrink-0 opacity-70" />
                    Home
                    <span
                        className={cn(
                            "ml-auto text-[10.5px] font-normal",
                            selectedId === null ? "text-brand-ink/70" : "text-ink-3"
                        )}
                    >
                        workflows
                    </span>
                </button>
                {loading && meetings.length === 0 && (
                    <div style={{ padding: "12px 8px", fontSize: 12.5, color: "var(--ink-3)" }}>
                        Loading…
                    </div>
                )}
                {error && (
                    <div style={{ padding: "12px 8px", fontSize: 12.5, color: "var(--danger)" }}>
                        {error}
                    </div>
                )}
                {!loading && meetings.length === 0 && !error && (
                    <div
                        style={{
                            padding: "12px 8px",
                            fontSize: 12.5,
                            color: "var(--ink-3)",
                            lineHeight: 1.6,
                        }}
                    >
                        No meetings yet. Pick a workflow on the home screen to start one.
                    </div>
                )}

                {live.length > 0 && <ListGroup label="Live now" />}
                {live.map(m => (
                    <ChannelRow
                        key={m.id}
                        meeting={m}
                        active={m.id === selectedId}
                        onClick={() => onSelect(m.id)}
                    />
                ))}

                {other.length > 0 && live.length > 0 && <ListGroup label="Recent" />}
                {other.map(m => (
                    <ChannelRow
                        key={m.id}
                        meeting={m}
                        active={m.id === selectedId}
                        onClick={() => onSelect(m.id)}
                    />
                ))}
            </div>
        </aside>
    );
}

function ListGroup({ label }: { label: string }) {
    return (
        <div
            className="mono"
            style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--ink-4, var(--ink-3))",
                padding: "12px 8px 6px",
            }}
        >
            {label}
        </div>
    );
}

function ChannelRow({
    meeting,
    active,
    onClick,
}: {
    meeting: MeetingSummary;
    active: boolean;
    onClick: () => void;
}) {
    const meta = MEETING_STATUS_META[meeting.status];
    const isLive = meeting.status === "running" || meeting.status === "human_control";

    return (
        <button
            onClick={onClick}
            style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "8px 9px",
                borderRadius: 8,
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent-ink)" : "var(--ink-2)",
                marginBottom: 2,
                transition: "background 120ms",
            }}
            onMouseEnter={e => {
                if (!active) e.currentTarget.style.background = "var(--line-2)";
            }}
            onMouseLeave={e => {
                if (!active) e.currentTarget.style.background = "transparent";
            }}
        >
            <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <IconHash size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                <span
                    style={{
                        fontSize: 12.5,
                        fontWeight: active ? 600 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                    }}
                >
                    {meeting.channelSlug ?? meeting.title}
                </span>
                {isLive && (
                    <span
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: statusColor(meta.tone),
                            flexShrink: 0,
                        }}
                    />
                )}
            </span>
            <span
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    paddingLeft: 19,
                }}
            >
                <span>{meta.label}</span>
                <span>·</span>
                <span>
                    {meeting.turnIndex}/{meeting.maxTurns} turns
                </span>
                {meeting.slackMirrorEnabled && <IconSlack size={10} style={{ opacity: 0.7 }} />}
            </span>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Channel view
// ---------------------------------------------------------------------------

function ChannelView({
    controller,
    onEnded,
}: {
    controller: ReturnType<typeof useMeeting>;
    onEnded: () => void;
}) {
    const {
        detail,
        state,
        messages,
        minutes,
        loading,
        error,
        busy,
        control,
        postMessage,
        runUntilDone,
        stopRunning,
        running,
    } = controller;
    const [draft, setDraft] = useState("");
    const [sidePanel, setSidePanel] = useState<"plan" | "minutes" | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const pinnedToBottom = useRef(true);

    // Autoscroll only when the reader is already at the bottom, so scrolling
    // back to re-read a turn is not yanked away by the next one.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !pinnedToBottom.current) return;
        el.scrollTop = el.scrollHeight;
    }, [messages]);

    const endedRef = useRef(false);
    useEffect(() => {
        if (!state) return;
        const finished = state.status === "completed" || state.status === "failed";
        if (finished && !endedRef.current) {
            endedRef.current = true;
            onEnded();
        }
        if (!finished) endedRef.current = false;
    }, [state, onEnded]);

    const participantsById = useMemo(() => {
        const map = new Map<string, MeetingParticipant>();
        for (const p of detail?.participants ?? []) map.set(p.id, p);
        return map;
    }, [detail]);

    const canSend = Boolean(state && state.status !== "completed" && state.status !== "failed");
    const holdsFloor = state?.status === "human_control";
    const seat = state?.controller?.asPersonaId;

    const send = useCallback(async () => {
        const text = draft.trim();
        if (!text) return;
        setDraft("");
        pinnedToBottom.current = true;
        await postMessage(text, seat);
    }, [draft, postMessage, seat]);

    if (loading && !detail) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-3)",
                    fontSize: 13,
                }}
            >
                Loading channel…
            </div>
        );
    }
    if (!detail || !state) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--danger)",
                    fontSize: 13,
                }}
            >
                {error ?? "Meeting unavailable"}
            </div>
        );
    }

    return (
        <main
            style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
        >
            <ChannelHeader
                title={detail.title}
                slug={detail.channelSlug}
                objective={detail.objective}
                participants={detail.participants}
                state={state}
                busy={busy}
                running={running}
                phases={detail.phases}
                workflowTitle={detail.workflowTitle}
                slackChannelId={detail.slack?.channelId ?? null}
                onControl={(action, options) => void control(action, options)}
                onRunToEnd={() => void runUntilDone()}
                onStop={stopRunning}
                sidePanel={sidePanel}
                onToggleSidePanel={panel =>
                    setSidePanel(current => (current === panel ? null : panel))
                }
            />

            {error && (
                <div
                    style={{
                        padding: "8px 20px",
                        fontSize: 12,
                        color: "var(--danger)",
                        background: "oklch(0.97 0.03 25)",
                        borderBottom: "1px solid oklch(0.9 0.06 25)",
                    }}
                >
                    {error}
                </div>
            )}

            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
                <div
                    ref={scrollRef}
                    onScroll={e => {
                        const el = e.currentTarget;
                        pinnedToBottom.current =
                            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                    }}
                    style={{ flex: 1, overflowY: "auto", padding: "16px 0 8px", minWidth: 0 }}
                >
                    {messages.length === 0 && (
                        <div
                            style={{
                                padding: "24px 24px",
                                fontSize: 13,
                                color: "var(--ink-3)",
                                lineHeight: 1.6,
                            }}
                        >
                            Nothing said yet. Press <strong>Run</strong> to let the agents take
                            their turns, or write the first message yourself.
                        </div>
                    )}
                    {messages.map((message, index) => (
                        <MessageRow
                            key={message.id}
                            message={message}
                            previous={messages[index - 1]}
                            participant={participantsById.get(
                                message.author.onBehalfOfPersonaId ?? message.author.id
                            )}
                        />
                    ))}
                    {state.status === "running" && state.nextSpeakerId && (
                        <TypingHint
                            participant={participantsById.get(state.nextSpeakerId)}
                            nextSpeakerId={state.nextSpeakerId}
                        />
                    )}
                </div>

                {sidePanel === "minutes" && minutes && (
                    <MinutesPanel minutes={minutes} onClose={() => setSidePanel(null)} />
                )}
                {sidePanel === "plan" && (
                    <PlanPanel
                        phases={detail.phases}
                        agenda={detail.agenda}
                        participants={detail.participants}
                        state={state}
                        maxTurns={detail.maxTurns}
                        workflowTitle={detail.workflowTitle}
                        onClose={() => setSidePanel(null)}
                    />
                )}
            </div>

            <Composer
                value={draft}
                onChange={setDraft}
                onSend={() => void send()}
                disabled={!canSend}
                sending={busy === "post"}
                holdsFloor={holdsFloor}
                seat={seat ? (participantsById.get(seat)?.displayName ?? seat) : undefined}
                status={state.status}
            />
        </main>
    );
}

// ---------------------------------------------------------------------------
// Header + controls
// ---------------------------------------------------------------------------

function ChannelHeader({
    title,
    slug,
    objective,
    participants,
    state,
    busy,
    running,
    phases,
    workflowTitle,
    slackChannelId,
    onControl,
    onRunToEnd,
    onStop,
    sidePanel,
    onToggleSidePanel,
}: {
    title: string;
    slug: string | null;
    objective: string;
    participants: MeetingParticipant[];
    state: NonNullable<ReturnType<typeof useMeeting>["state"]>;
    busy: string | null;
    running: boolean;
    phases: MeetingPhase[];
    workflowTitle: string | null;
    slackChannelId: string | null;
    onControl: (action: ControlAction, options?: { asPersonaId?: string; limit?: number }) => void;
    onRunToEnd: () => void;
    onStop: () => void;
    sidePanel: "plan" | "minutes" | null;
    onToggleSidePanel: (panel: "plan" | "minutes") => void;
}) {
    const meta = MEETING_STATUS_META[state.status];
    const finished = state.status === "completed" || state.status === "failed";
    const holdsFloor = state.status === "human_control";
    const phase = state.phaseIndex !== undefined ? phases[state.phaseIndex] : undefined;

    return (
        <header
            style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--line)",
                background: "var(--panel)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                flexShrink: 0,
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                    <div
                        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                        <IconHash size={15} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                            {slug ?? title}
                        </span>
                        <StatusPill label={meta.label} tone={meta.tone} />
                        {workflowTitle && (
                            <span
                                title="The workflow this meeting follows"
                                className="border-line text-ink-3 inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px text-[10.5px]"
                            >
                                <Workflow className="size-2.5" /> {workflowTitle}
                            </span>
                        )}
                        {phase && !finished && (
                            <button
                                type="button"
                                onClick={() => onToggleSidePanel("plan")}
                                title={phase.goal}
                                className="bg-brand-soft text-brand-ink inline-flex items-center gap-1 rounded-[5px] px-1.5 py-px text-[10.5px] font-semibold"
                            >
                                Phase {(state.phaseIndex ?? 0) + 1}/{phases.length} · {phase.title}
                            </button>
                        )}
                        {slackChannelId && (
                            <span
                                title={`Mirrored to Slack channel ${slackChannelId}`}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 10.5,
                                    color: "var(--ink-3)",
                                    border: "1px solid var(--line)",
                                    borderRadius: 5,
                                    padding: "1px 6px",
                                }}
                            >
                                <IconSlack size={10} /> Mirrored
                            </span>
                        )}
                    </div>
                    <div
                        style={{
                            fontSize: 11.5,
                            color: "var(--ink-3)",
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                        title={objective}
                    >
                        {objective}
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                        marginLeft: "auto",
                    }}
                >
                    {!finished && state.status !== "running" && (
                        <ControlButton
                            icon={<IconPlay size={12} />}
                            label={state.status === "scheduled" ? "Run" : "Resume"}
                            primary
                            busy={busy === "run" || busy === "resume" || busy === "start"}
                            onClick={() =>
                                state.status === "paused" || state.status === "human_control"
                                    ? onControl("resume")
                                    : onRunToEnd()
                            }
                        />
                    )}
                    {state.status === "running" && !running && (
                        <>
                            <ControlButton
                                icon={<Zap size={12} />}
                                label="Run to the end"
                                primary
                                busy={busy === "run"}
                                onClick={onRunToEnd}
                            />
                            <ControlButton
                                icon={<IconPlay size={12} />}
                                label="One turn"
                                busy={busy === "step"}
                                onClick={() => onControl("step")}
                            />
                            <ControlButton
                                icon={<IconPause size={12} />}
                                label="Pause"
                                busy={busy === "pause"}
                                onClick={() => onControl("pause")}
                            />
                        </>
                    )}
                    {state.status === "running" && running && (
                        <>
                            <span className="text-ink-3 inline-flex items-center gap-1.5 text-[11.5px]">
                                <span className="bg-success size-1.5 animate-pulse rounded-full" />
                                Running…
                            </span>
                            <ControlButton
                                icon={<Square size={11} />}
                                label="Stop after this turn"
                                onClick={onStop}
                            />
                        </>
                    )}
                    {!finished &&
                        (holdsFloor ? (
                            <ControlButton
                                icon={<IconCheck size={12} />}
                                label="Hand back"
                                busy={busy === "release"}
                                onClick={() => onControl("release")}
                            />
                        ) : (
                            <ControlButton
                                icon={<IconHand size={12} />}
                                label="Take over"
                                busy={busy === "takeover"}
                                onClick={() => onControl("takeover")}
                            />
                        ))}
                    {!finished && (
                        <ControlButton
                            icon={<IconStop size={12} />}
                            label="End"
                            busy={busy === "complete"}
                            onClick={() => onControl("complete")}
                        />
                    )}
                    <ControlButton
                        icon={<ListChecks size={12} />}
                        label="Plan"
                        active={sidePanel === "plan"}
                        onClick={() => onToggleSidePanel("plan")}
                    />
                    <ControlButton
                        icon={<IconClock size={12} />}
                        label="Minutes"
                        active={sidePanel === "minutes"}
                        onClick={() => onToggleSidePanel("minutes")}
                    />
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {participants.map(p => (
                    <ParticipantChip
                        key={p.id}
                        participant={p}
                        speaking={state.status === "running" && state.nextSpeakerId === p.id}
                        occupied={state.controller?.asPersonaId === p.id}
                    />
                ))}
                {state.controller && (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 11,
                            color: "oklch(0.45 0.13 55)",
                            background: "oklch(0.96 0.06 70)",
                            border: "1px solid oklch(0.88 0.1 70)",
                            borderRadius: 999,
                            padding: "2px 9px",
                        }}
                    >
                        <IconHand size={10} />
                        {state.controller.displayName} has the floor
                        {state.controller.asPersonaId ? ` as @${state.controller.asPersonaId}` : ""}
                    </span>
                )}
            </div>
        </header>
    );
}

function StatusPill({
    label,
    tone,
}: {
    label: string;
    tone: "live" | "idle" | "human" | "done" | "bad";
}) {
    const color = statusColor(tone);
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10.5,
                fontWeight: 600,
                color,
                border: `1px solid ${color}`,
                borderRadius: 999,
                padding: "1px 8px",
                opacity: tone === "done" ? 0.75 : 1,
            }}
        >
            {tone === "live" && (
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
            )}
            {label}
        </span>
    );
}

function ControlButton({
    icon,
    label,
    onClick,
    primary,
    busy,
    active,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    primary?: boolean;
    busy?: boolean;
    active?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={busy}
            title={label}
            aria-pressed={active}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 7,
                fontSize: 11.5,
                fontWeight: 600,
                border: primary
                    ? "1px solid transparent"
                    : `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                background: primary
                    ? "var(--accent)"
                    : active
                      ? "var(--accent-soft)"
                      : "var(--panel-2)",
                color: primary ? "white" : active ? "var(--accent-ink)" : "var(--ink-2)",
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "progress" : "pointer",
                whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
                if (!primary && !busy) e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={e => {
                if (!primary) e.currentTarget.style.borderColor = "var(--line)";
            }}
        >
            {icon}
            {label}
        </button>
    );
}

function ParticipantChip({
    participant,
    speaking,
    occupied,
}: {
    participant: MeetingParticipant;
    speaking: boolean;
    occupied: boolean;
}) {
    const color = personaColor(participant);
    return (
        <span
            title={`${participant.displayName} — ${participant.role}${
                participant.nodeId ? ` · runs on ${participant.nodeId}` : ""
            }`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "var(--ink-2)",
                border: `1px solid ${speaking ? color : "var(--line)"}`,
                background: speaking ? "var(--panel-2)" : "transparent",
                borderRadius: 999,
                padding: "2px 9px 2px 3px",
                opacity: occupied ? 0.55 : 1,
            }}
        >
            <AgentAvatar agent={participant} size={16} />@{participant.id}
            {participant.nodeId && <IconServer size={9} style={{ opacity: 0.6 }} />}
        </span>
    );
}

function Avatar({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: size > 20 ? 7 : "50%",
                background: color,
                color: "white",
                fontSize: size > 20 ? 10.5 : 8,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                letterSpacing: "0.02em",
            }}
        >
            {initialsOf(name)}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function MessageRow({
    message,
    previous,
    participant,
}: {
    message: ChannelMessage;
    previous?: ChannelMessage;
    participant?: MeetingParticipant;
}) {
    if (message.kind === "system") {
        const isPhase = message.meta?.event === "phase";
        if (isPhase) {
            return (
                <div className="my-2 flex items-center gap-3 px-6">
                    <span className="bg-line h-px flex-1" />
                    <span className="bg-brand-soft text-brand-ink inline-flex max-w-[70%] items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold">
                        <Workflow className="size-3 shrink-0" />
                        <span className="truncate">{message.text}</span>
                    </span>
                    <span className="bg-line h-px flex-1" />
                </div>
            );
        }
        return (
            <div
                style={{
                    padding: "5px 24px",
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <span style={{ flex: "0 0 auto", opacity: 0.55 }}>
                    <IconBroadcast size={11} />
                </span>
                <span style={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>{message.text}</span>
            </div>
        );
    }

    // Consecutive turns from the same speaker collapse into one block, the way
    // a chat client groups them.
    const grouped =
        previous &&
        previous.kind !== "system" &&
        previous.author.id === message.author.id &&
        previous.author.onBehalfOfPersonaId === message.author.onBehalfOfPersonaId;

    const isHuman = message.author.kind === "human";
    const color = isHuman
        ? "oklch(0.5 0.02 280)"
        : personaColor(participant ?? { id: message.author.id });
    const servedBy =
        typeof message.meta?.servedByNode === "string" ? message.meta.servedByNode : null;

    return (
        <div
            style={{
                display: "flex",
                gap: 10,
                padding: grouped ? "1px 24px" : "8px 24px 1px",
            }}
        >
            <div style={{ width: 26, flexShrink: 0 }}>
                {!grouped &&
                    (isHuman ? (
                        <Avatar name={message.author.displayName} color={color} />
                    ) : (
                        <AgentAvatar
                            agent={{
                                id: message.author.id,
                                displayName: message.author.displayName,
                                accent: participant?.accent ?? null,
                                avatarUrl: participant?.avatarUrl ?? null,
                            }}
                            size={26}
                        />
                    ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                {!grouped && (
                    <div
                        style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 2 }}
                    >
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                            {message.author.displayName}
                        </span>
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 10,
                                color: "var(--ink-3)",
                            }}
                        >
                            {isHuman ? <IconUser size={9} /> : <IconRobot size={9} />}
                            {isHuman ? "human" : `@${message.author.id}`}
                        </span>
                        {message.author.onBehalfOfPersonaId && (
                            <span style={{ fontSize: 10, color: "oklch(0.5 0.13 55)" }}>
                                holding @{message.author.onBehalfOfPersonaId}
                            </span>
                        )}
                        {servedBy && (
                            <span
                                title={`This turn was produced on node "${servedBy}"`}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 9.5,
                                    color: "var(--ink-3)",
                                }}
                            >
                                <IconServer size={9} />
                                {servedBy}
                            </span>
                        )}
                        {message.slackTs && (
                            <IconSlack size={9} style={{ color: "var(--ink-3)", opacity: 0.7 }} />
                        )}
                        <span
                            className="mono"
                            style={{ fontSize: 9.5, color: "var(--ink-3)", opacity: 0.7 }}
                        >
                            {formatTime(message.ts)}
                        </span>
                    </div>
                )}
                <div
                    style={{
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: "var(--ink-2)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {renderMentions(message.text)}
                </div>
            </div>
        </div>
    );
}

/** Highlights `@handle` so it reads as an address, not as prose. */
function renderMentions(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    for (const match of text.matchAll(/@([a-zA-Z0-9_-]+)/g)) {
        const start = match.index ?? 0;
        if (start > lastIndex) parts.push(text.slice(lastIndex, start));
        parts.push(
            <span
                key={`${start}-${match[0]}`}
                style={{
                    color: "var(--accent-ink)",
                    background: "var(--accent-soft)",
                    borderRadius: 3,
                    padding: "0 2px",
                }}
            >
                {match[0]}
            </span>
        );
        lastIndex = start + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
}

function TypingHint({
    participant,
    nextSpeakerId,
}: {
    participant?: MeetingParticipant;
    nextSpeakerId: string;
}) {
    return (
        <div style={{ display: "flex", gap: 10, padding: "8px 24px", alignItems: "center" }}>
            <div style={{ width: 26, flexShrink: 0 }}>
                <AgentAvatar
                    agent={{
                        id: nextSpeakerId,
                        displayName: participant?.displayName ?? nextSpeakerId,
                        accent: participant?.accent ?? null,
                        avatarUrl: participant?.avatarUrl ?? null,
                    }}
                    size={26}
                />
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
                {participant?.displayName ?? `@${nextSpeakerId}`} is up next…
            </span>
        </div>
    );
}

function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Plan — the phases and agenda, with where the meeting is
// ---------------------------------------------------------------------------

function PlanPanel({
    phases,
    agenda,
    participants,
    state,
    maxTurns,
    workflowTitle,
    onClose,
}: {
    phases: MeetingPhase[];
    agenda: string[];
    participants: MeetingParticipant[];
    state: NonNullable<ReturnType<typeof useMeeting>["state"]>;
    maxTurns: number;
    workflowTitle: string | null;
    onClose: () => void;
}) {
    const byId = new Map(participants.map(p => [p.id, p]));
    // Phase boundaries are a pure function of the turn index; recomputing
    // them here keeps the panel honest about progress even between polls.
    let start = 0;
    const rows = phases.map((phase, index) => {
        const phaseStart = start;
        start += Math.max(1, phase.turns);
        const done = Math.max(0, Math.min(phase.turns, state.turnIndex - phaseStart));
        const current = state.phaseIndex === index && state.status !== "completed";
        return {
            phase,
            index,
            done,
            current,
            complete: state.turnIndex >= phaseStart + phase.turns,
        };
    });

    return (
        <aside className="border-line bg-panel w-[300px] shrink-0 overflow-y-auto border-l px-4 pb-6 pt-3.5">
            <div className="mb-3 flex items-center gap-2">
                <div className="mono text-ink-3 flex-1 text-[10px] font-bold uppercase tracking-[0.1em]">
                    Plan{workflowTitle ? ` · ${workflowTitle}` : ""}
                </div>
                <button onClick={onClose} aria-label="Close plan" className="text-ink-3">
                    <IconX size={13} />
                </button>
            </div>

            <div className="text-ink-3 mb-3 text-[11.5px]">
                Turn {Math.min(state.turnIndex, maxTurns)} of {maxTurns}
                {state.status === "completed" ? " · ended" : ""}
            </div>

            {rows.length === 0 ? (
                <div className="text-ink-3 mb-4 text-[12px] leading-relaxed">
                    No phases — the turn policy runs the whole meeting. Start the next one from a
                    workflow to get diverge / critique / decide stretches.
                </div>
            ) : (
                <ol className="m-0 mb-5 flex list-none flex-col gap-2 p-0">
                    {rows.map(({ phase, index, done, current, complete }) => {
                        const speakers = (phase.speakerIds ?? [])
                            .map(id => byId.get(id))
                            .filter((p): p is MeetingParticipant => Boolean(p));
                        return (
                            <li
                                key={phase.id}
                                aria-current={current ? "step" : undefined}
                                className={cn(
                                    "rounded-lg border px-3 py-2.5",
                                    current
                                        ? "border-brand bg-brand-soft/60"
                                        : complete
                                          ? "border-line bg-panel-2 opacity-70"
                                          : "border-line bg-panel-2"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="mono text-ink-3 text-[10px] font-bold">
                                        {index + 1}
                                    </span>
                                    <span className="text-ink flex-1 text-[12.5px] font-semibold">
                                        {phase.title}
                                    </span>
                                    <span className="mono text-ink-3 text-[10px]">
                                        {done}/{phase.turns}
                                    </span>
                                </div>
                                <div className="text-ink-2 mt-1 text-[11.5px] leading-snug">
                                    {phase.goal}
                                </div>
                                <div className="bg-line mt-2 h-1 overflow-hidden rounded-full">
                                    <div
                                        className="bg-brand h-full rounded-full transition-[width]"
                                        style={{
                                            width: `${(done / Math.max(1, phase.turns)) * 100}%`,
                                        }}
                                    />
                                </div>
                                <div className="mt-2 flex items-center gap-1">
                                    {speakers.length === 0 ? (
                                        <span className="text-ink-3 text-[10.5px]">
                                            Everyone speaks
                                        </span>
                                    ) : (
                                        speakers.map(p => (
                                            <AgentAvatar
                                                key={p.id}
                                                agent={p}
                                                size={20}
                                                title={`${p.displayName} — ${p.role}`}
                                            />
                                        ))
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}

            {agenda.length > 0 && (
                <>
                    <div className="mono text-ink-3 mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em]">
                        Agenda
                    </div>
                    <ol className="text-ink-2 m-0 pl-4 text-[12px] leading-relaxed">
                        {agenda.map((item, index) => (
                            <li key={`${index}-${item}`}>{item}</li>
                        ))}
                    </ol>
                </>
            )}
        </aside>
    );
}

// ---------------------------------------------------------------------------
// Minutes
// ---------------------------------------------------------------------------

function MinutesPanel({
    minutes,
    onClose,
}: {
    minutes: NonNullable<ReturnType<typeof useMeeting>["minutes"]>;
    onClose: () => void;
}) {
    return (
        <aside
            style={{
                width: 300,
                flexShrink: 0,
                borderLeft: "1px solid var(--line)",
                background: "var(--panel)",
                overflowY: "auto",
                padding: "14px 16px 24px",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div
                    className="mono"
                    style={{
                        flex: 1,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--ink-3)",
                    }}
                >
                    Minutes
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close minutes"
                    style={{ color: "var(--ink-3)" }}
                >
                    <IconX size={13} />
                </button>
            </div>

            <MinutesSection title="Decisions" empty="Nothing decided yet.">
                {minutes.decisions.map(d => (
                    <li key={`${d.sourceSeq}-${d.text}`} style={minutesItemStyle}>
                        {d.text}
                        <span
                            style={{
                                display: "block",
                                fontSize: 10.5,
                                color: "var(--ink-3)",
                                marginTop: 2,
                            }}
                        >
                            {d.author}
                        </span>
                    </li>
                ))}
            </MinutesSection>

            <MinutesSection title="Action items" empty="No owners assigned yet.">
                {minutes.actionItems.map(a => (
                    <li key={`${a.sourceSeq}-${a.text}`} style={minutesItemStyle}>
                        {a.text}
                        {a.owner && (
                            <span
                                style={{
                                    display: "block",
                                    fontSize: 10.5,
                                    color: "var(--accent-ink)",
                                    marginTop: 2,
                                }}
                            >
                                @{a.owner}
                            </span>
                        )}
                    </li>
                ))}
            </MinutesSection>

            <div style={{ marginTop: 18 }}>
                <div
                    className="mono"
                    style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--ink-3)",
                        marginBottom: 6,
                    }}
                >
                    Key points
                </div>
                <div
                    style={{
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: "var(--ink-2)",
                        whiteSpace: "pre-wrap",
                    }}
                >
                    {minutes.summary}
                </div>
            </div>

            <div
                style={{
                    marginTop: 18,
                    paddingTop: 12,
                    borderTop: "1px solid var(--line)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    lineHeight: 1.7,
                }}
            >
                {minutes.turnsTaken} agent turn{minutes.turnsTaken === 1 ? "" : "s"} ·{" "}
                {minutes.humanInterventions} human message
                {minutes.humanInterventions === 1 ? "" : "s"}
                <div style={{ marginTop: 6 }}>
                    Extracted from the transcript, never generated — every line above was said by
                    someone in this channel.
                </div>
            </div>
        </aside>
    );
}

const minutesItemStyle: React.CSSProperties = {
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--ink-2)",
    padding: "7px 9px",
    border: "1px solid var(--line)",
    borderRadius: 7,
    background: "var(--panel-2)",
    marginBottom: 6,
    listStyle: "none",
};

function MinutesSection({
    title,
    empty,
    children,
}: {
    title: string;
    empty: string;
    children: React.ReactNode[];
}) {
    return (
        <div style={{ marginBottom: 16 }}>
            <div
                className="mono"
                style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                    marginBottom: 6,
                }}
            >
                {title}
            </div>
            {children.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{empty}</div>
            ) : (
                <ul style={{ margin: 0, padding: 0 }}>{children}</ul>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
    value,
    onChange,
    onSend,
    disabled,
    sending,
    holdsFloor,
    seat,
    status,
}: {
    value: string;
    onChange: (next: string) => void;
    onSend: () => void;
    disabled: boolean;
    sending: boolean;
    holdsFloor: boolean;
    seat?: string;
    status: string;
}) {
    const placeholder = disabled
        ? "This meeting has ended."
        : holdsFloor
          ? seat
              ? `Speaking as ${seat} — the agents are on hold`
              : "You have the floor — the agents are on hold"
          : "Add a comment. The agents will read it on their next turn.";

    return (
        <div
            style={{
                borderTop: "1px solid var(--line)",
                background: "var(--panel)",
                padding: "10px 20px 14px",
                flexShrink: 0,
            }}
        >
            {holdsFloor && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: "oklch(0.45 0.13 55)",
                        marginBottom: 7,
                    }}
                >
                    <IconHand size={11} /> Agent turns are paused while you hold the floor.
                </div>
            )}
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 8,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    background: "var(--panel-2)",
                    padding: "8px 10px",
                    opacity: disabled ? 0.6 : 1,
                }}
            >
                <textarea
                    value={value}
                    disabled={disabled}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            onSend();
                        }
                    }}
                    rows={1}
                    placeholder={placeholder}
                    style={{
                        flex: 1,
                        resize: "none",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--ink)",
                        fontSize: 13,
                        lineHeight: 1.55,
                        maxHeight: 160,
                        fontFamily: "inherit",
                    }}
                    onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                />
                <button
                    onClick={onSend}
                    disabled={disabled || sending || value.trim().length === 0}
                    style={{
                        padding: "6px 12px",
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        background:
                            disabled || value.trim().length === 0 ? "var(--line)" : "var(--accent)",
                        color: disabled || value.trim().length === 0 ? "var(--ink-3)" : "white",
                        cursor: disabled || value.trim().length === 0 ? "not-allowed" : "pointer",
                        flexShrink: 0,
                    }}
                >
                    {sending ? "Sending…" : "Send"}
                </button>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 6 }}>
                {status === "running"
                    ? "Enter to send · your message lands in the transcript before the next agent turn"
                    : "Enter to send · Shift+Enter for a new line"}
            </div>
        </div>
    );
}
