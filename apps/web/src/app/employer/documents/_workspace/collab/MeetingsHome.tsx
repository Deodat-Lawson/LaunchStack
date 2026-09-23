"use client";

/**
 * The Meetings dashboard — what you land on before picking a room.
 *
 * The old landing was a channel list and an empty frame, which answers "what
 * is this?" with nothing. This page answers it in one screen: what a meeting
 * is (three steps), which workflows exist (the cards, each a recipe with
 * phases and a suggested room), what is live and recent, and who the agents
 * are. Every card is a one-click start.
 */

import React, { useMemo } from "react";
import {
    ArrowRight,
    Bot,
    Clock,
    ListChecks,
    Play,
    Plus,
    Radio,
    Users,
    Workflow,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    MEETING_WORKFLOWS,
    WORKFLOW_CATEGORY_META,
    workflowTurnCount,
    type MeetingWorkflow,
} from "~/lib/agents/meeting-workflows";
import { cn } from "~/lib/utils";

import {
    initialsOf,
    MEETING_STATUS_META,
    personaColor,
    statusColor,
    type AgentPersonaRecord,
    type MeetingSummary,
} from "./types";

export interface MeetingsHomeProps {
    meetings: MeetingSummary[];
    agents: AgentPersonaRecord[];
    loading: boolean;
    onStart: (workflowKey?: string) => void;
    onOpen: (meetingId: string) => void;
    onManageAgents?: () => void;
}

const STEPS = [
    {
        Icon: Workflow,
        title: "Pick a workflow",
        body: "A recipe: the objective, the agenda, who belongs in the room, and the phases the conversation moves through.",
    },
    {
        Icon: Users,
        title: "Choose the room",
        body: "Any of your agents can take a seat. Each speaks from its standing instructions and cites the workspace's sources.",
    },
    {
        Icon: Play,
        title: "Run it, step in any time",
        body: "Turns run on their own. Read along, add a comment, take the floor, or take over an agent's seat. Minutes are extracted from what was said.",
    },
];

export function MeetingsHome({
    meetings,
    agents,
    loading,
    onStart,
    onOpen,
    onManageAgents,
}: MeetingsHomeProps) {
    const live = meetings.filter(m => m.status === "running" || m.status === "human_control");
    const recent = meetings.filter(m => !live.includes(m)).slice(0, 6);
    const byKey = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
    const grouped = useMemo(() => {
        const groups = new Map<MeetingWorkflow["category"], MeetingWorkflow[]>();
        for (const workflow of MEETING_WORKFLOWS) {
            const list = groups.get(workflow.category) ?? [];
            list.push(workflow);
            groups.set(workflow.category, list);
        }
        return [...groups.entries()];
    }, []);

    return (
        <div className="bg-surface h-full min-h-0 overflow-y-auto">
            <div className="mx-auto max-w-[1080px] px-7 pb-16 pt-8">
                <header className="mb-8 flex items-start gap-6">
                    <div className="min-w-0 flex-1">
                        <div className="mono text-ink-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Meetings
                        </div>
                        <h1 className="serif text-ink m-0 text-[30px] leading-[1.1] tracking-tight">
                            Put your agents in a room and give them a job
                        </h1>
                        <p className="text-ink-3 mt-2 max-w-[640px] text-[13.5px] leading-relaxed">
                            A meeting is a channel where the participants are agents and you are a
                            participant too. Pick a workflow, choose the room, press run. The
                            transcript is the record; the minutes are extracted from it, never
                            invented.
                        </p>
                    </div>
                    <Button onClick={() => onStart()} className="shrink-0">
                        <Plus className="size-4" /> New meeting
                    </Button>
                </header>

                <section className="mb-9 grid grid-cols-3 gap-3">
                    {STEPS.map((step, index) => (
                        <div
                            key={step.title}
                            className="border-line bg-panel rounded-xl border p-4"
                        >
                            <div className="mb-2 flex items-center gap-2.5">
                                <span className="bg-brand-soft text-brand-ink inline-flex size-7 items-center justify-center rounded-lg">
                                    <step.Icon className="size-3.5" />
                                </span>
                                <span className="mono text-ink-3 text-[10px] font-bold tracking-[0.08em]">
                                    STEP {index + 1}
                                </span>
                            </div>
                            <div className="text-ink text-[13.5px] font-semibold">{step.title}</div>
                            <p className="text-ink-3 mt-1 text-[12.5px] leading-relaxed">
                                {step.body}
                            </p>
                        </div>
                    ))}
                </section>

                {(live.length > 0 || recent.length > 0 || loading) && (
                    <section className="mb-9">
                        <SectionHeading
                            Icon={live.length > 0 ? Radio : Clock}
                            title={live.length > 0 ? "Live now" : "Recent"}
                            hint={
                                live.length > 0
                                    ? `${live.length} meeting${live.length === 1 ? "" : "s"} running`
                                    : "Reopen a room to read the transcript or its minutes."
                            }
                        />
                        <div className="grid grid-cols-2 gap-3">
                            {[...live, ...recent].map(meeting => (
                                <MeetingCard
                                    key={meeting.id}
                                    meeting={meeting}
                                    onOpen={() => onOpen(meeting.id)}
                                />
                            ))}
                            {loading && meetings.length === 0 && (
                                <div className="text-ink-3 col-span-2 text-[12.5px]">
                                    Loading meetings…
                                </div>
                            )}
                        </div>
                    </section>
                )}

                <section className="mb-9">
                    <SectionHeading
                        Icon={Workflow}
                        title="Start from a workflow"
                        hint="Each card is a recipe with phases the engine enforces. Everything is editable before you start."
                    />
                    <div className="flex flex-col gap-5">
                        {grouped.map(([category, workflows]) => (
                            <div key={category}>
                                <div className="mono text-ink-3 mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                                    {WORKFLOW_CATEGORY_META[category].label}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {workflows.map(workflow => (
                                        <WorkflowCard
                                            key={workflow.key}
                                            workflow={workflow}
                                            agents={byKey}
                                            onStart={() => onStart(workflow.key)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <SectionHeading
                        Icon={Bot}
                        title={`Your agents${agents.length > 0 ? ` (${agents.length})` : ""}`}
                        hint="The same roster answers in chat and sits in meetings. Try one out or write your own."
                        action={
                            onManageAgents ? (
                                <Button variant="outline" size="sm" onClick={onManageAgents}>
                                    Open Agents <ArrowRight className="size-3.5" />
                                </Button>
                            ) : undefined
                        }
                    />
                    <div className="flex flex-wrap gap-2">
                        {agents.map(agent => (
                            <span
                                key={agent.id}
                                title={agent.description || agent.role}
                                className="border-line bg-panel text-ink-2 inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12px]"
                            >
                                <span
                                    className="inline-flex size-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                                    style={{ background: personaColor(agent) }}
                                >
                                    {initialsOf(agent.displayName)}
                                </span>
                                <span className="font-medium">{agent.displayName}</span>
                                <span className="text-ink-3">{agent.role}</span>
                            </span>
                        ))}
                        {agents.length === 0 && !loading && (
                            <span className="text-ink-3 text-[12.5px]">No agents yet.</span>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

function SectionHeading({
    Icon,
    title,
    hint,
    action,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    title: string;
    hint?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="mb-3 flex items-end gap-3">
            <div className="min-w-0 flex-1">
                <h2 className="text-ink m-0 flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]">
                    <Icon className="text-ink-3 size-4" />
                    {title}
                </h2>
                {hint && <div className="text-ink-3 mt-0.5 text-[12.5px]">{hint}</div>}
            </div>
            {action}
        </div>
    );
}

function WorkflowCard({
    workflow,
    agents,
    onStart,
}: {
    workflow: MeetingWorkflow;
    agents: Map<string, AgentPersonaRecord>;
    onStart: () => void;
}) {
    const turns = workflowTurnCount(workflow);
    const seats = workflow.agents
        .map(key => agents.get(key))
        .filter((a): a is AgentPersonaRecord => Boolean(a));
    return (
        <button
            type="button"
            onClick={onStart}
            className={cn(
                "border-line bg-panel hover:border-brand group flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors",
                "focus-visible:border-brand focus-visible:ring-brand/50 outline-none focus-visible:ring-[3px]"
            )}
        >
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-ink text-[14px] font-semibold">{workflow.title}</div>
                    <div className="text-ink-2 mt-0.5 text-[12.5px]">{workflow.tagline}</div>
                </div>
                <span className="bg-brand-soft text-brand-ink inline-flex size-7 shrink-0 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Play className="size-3.5" />
                </span>
            </div>
            <p className="text-ink-3 m-0 text-[12px] leading-relaxed">{workflow.description}</p>
            {workflow.phases.length > 0 ? (
                <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
                    {workflow.phases.map((phase, index) => (
                        <li key={phase.id} className="flex items-center gap-1">
                            <span
                                className="bg-line-2 text-ink-2 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                                title={phase.goal}
                            >
                                {phase.title}
                                <span className="text-ink-3 ml-1 font-normal">×{phase.turns}</span>
                            </span>
                            {index < workflow.phases.length - 1 && (
                                <ArrowRight className="text-ink-4 size-3" />
                            )}
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="text-ink-3 text-[11.5px] italic">
                    No phases — the turn policy runs the room.
                </div>
            )}
            <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5">
                    {seats.slice(0, 6).map(agent => (
                        <span
                            key={agent.id}
                            title={`${agent.displayName} — ${agent.role}`}
                            className="border-panel inline-flex size-6 items-center justify-center rounded-full border-2 text-[8px] font-bold text-white"
                            style={{ background: personaColor(agent) }}
                        >
                            {initialsOf(agent.displayName)}
                        </span>
                    ))}
                </div>
                <span className="text-ink-3 text-[11.5px]">
                    {seats.length} seat{seats.length === 1 ? "" : "s"}
                    {turns > 0 ? ` · ${turns} turns` : ""}
                    {" · "}
                    {workflow.turnPolicy === "moderated"
                        ? "chaired"
                        : workflow.turnPolicy === "reactive"
                          ? "reactive"
                          : "round robin"}
                </span>
            </div>
        </button>
    );
}

function MeetingCard({ meeting, onOpen }: { meeting: MeetingSummary; onOpen: () => void }) {
    const meta = MEETING_STATUS_META[meeting.status];
    const progress = meeting.maxTurns > 0 ? Math.min(1, meeting.turnIndex / meeting.maxTurns) : 0;
    const isLive = meeting.status === "running" || meeting.status === "human_control";
    return (
        <button
            type="button"
            onClick={onOpen}
            className="border-line bg-panel hover:border-brand focus-visible:border-brand focus-visible:ring-brand/50 flex flex-col gap-2.5 rounded-xl border p-4 text-left outline-none transition-colors focus-visible:ring-[3px]"
        >
            <div className="flex items-center gap-2">
                <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[10.5px] font-semibold"
                    style={{ color: statusColor(meta.tone), borderColor: statusColor(meta.tone) }}
                >
                    {isLive && (
                        <span
                            className="size-1.5 rounded-full"
                            style={{ background: statusColor(meta.tone) }}
                        />
                    )}
                    {meta.label}
                </span>
                {meeting.workflowTitle && (
                    <Badge variant="secondary">{meeting.workflowTitle}</Badge>
                )}
                <span className="text-ink-3 ml-auto text-[11px]">
                    {relativeDate(meeting.createdAt)}
                </span>
            </div>
            <div className="text-ink text-[14px] font-semibold">{meeting.title}</div>
            <div className="text-ink-3 line-clamp-2 text-[12px] leading-relaxed">
                {meeting.objective}
            </div>
            <div className="flex items-center gap-2.5">
                <div className="flex -space-x-1.5">
                    {meeting.participants.slice(0, 6).map(p => (
                        <span
                            key={p.id}
                            title={`${p.displayName} — ${p.role}`}
                            className="border-panel inline-flex size-5 items-center justify-center rounded-full border-2 text-[7px] font-bold text-white"
                            style={{ background: personaColor(p) }}
                        >
                            {initialsOf(p.displayName)}
                        </span>
                    ))}
                </div>
                <div className="bg-line-2 h-1 flex-1 overflow-hidden rounded-full">
                    <div
                        className="bg-brand h-full rounded-full"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
                <span className="mono text-ink-3 text-[10.5px]">
                    {meeting.turnIndex}/{meeting.maxTurns}
                </span>
                <ListChecks className="text-ink-4 size-3.5" />
            </div>
        </button>
    );
}

function relativeDate(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((Date.now() - then) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
