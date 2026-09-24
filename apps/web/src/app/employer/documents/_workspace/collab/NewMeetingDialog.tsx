"use client";

/**
 * Start a meeting: a workflow, the room, the objective — then the details.
 *
 * The dialog is a short path with the recipe up front. Picking a workflow
 * prefills everything (objective, agenda, seats, chair, turn policy, phases),
 * so the fastest path is: pick a card, fix the objective's blank, press
 * start. Everything is still editable, and "Open discussion" is a workflow
 * too — the one with no phases.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Hash, Server, Workflow } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Field, SelectInput, TextArea, TextInput } from "~/components/field";
import { IconSlack } from "~/components/icons/brand";
import {
    DEFAULT_AGENT_AUTONOMY,
    effectiveAutonomy,
    isAgentAutonomy,
    meetingPlanViolations,
} from "~/lib/agents/autonomy";
import {
    MEETING_WORKFLOWS,
    meetingWorkflow,
    phasesForRoom,
    workflowTurnCount,
    type MeetingWorkflow,
} from "~/lib/agents/meeting-workflows";
import { cn } from "~/lib/utils";

import { useAgents } from "./useMeetings";
import { AgentAvatar } from "./AgentAvatar";
import { personaColor, type AgentPersonaRecord, type MeetingPhase } from "./types";

export interface NewMeetingDialogProps {
    open: boolean;
    onClose: () => void;
    onCreated: (meetingId: string) => void;
    /** Workflow to start from; the dialog opens on its details. */
    initialWorkflowKey?: string | null;
    /** Agents to seat in addition to the workflow's suggestions. */
    initialSeats?: string[] | null;
}

const TURN_POLICIES = [
    {
        id: "round_robin",
        label: "Round robin",
        desc: "Everyone speaks in turn. Predictable, and no one dominates.",
    },
    {
        id: "moderated",
        label: "Moderated",
        desc: "A chair opens, closes, and hands the floor to whoever they name.",
    },
    {
        id: "reactive",
        label: "Reactive",
        desc: "Whoever was addressed speaks next; otherwise the closest role picks it up.",
    },
] as const;

type PolicyId = (typeof TURN_POLICIES)[number]["id"];

const CUSTOM: MeetingWorkflow = {
    key: "custom",
    title: "Custom",
    tagline: "Start from a blank room.",
    description: "",
    objectiveTemplate: "",
    agenda: [],
    agents: [],
    turnPolicy: "round_robin",
    phases: [],
    category: "explore",
};

export function NewMeetingDialog({
    open,
    onClose,
    onCreated,
    initialWorkflowKey,
    initialSeats,
}: NewMeetingDialogProps) {
    const { data, loading } = useAgents();
    const personas = useMemo(() => data?.personas.filter(p => !p.archived) ?? [], [data]);

    const [workflowKey, setWorkflowKey] = useState<string>("decision-review");
    const [title, setTitle] = useState("");
    const [objective, setObjective] = useState("");
    const [agenda, setAgenda] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [policy, setPolicy] = useState<PolicyId>("round_robin");
    const [moderator, setModerator] = useState<string>("");
    const [maxTurns, setMaxTurns] = useState(10);
    const [usePhases, setUsePhases] = useState(true);
    const [slackChannelId, setSlackChannelId] = useState("");
    const [mirror, setMirror] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const workflow = meetingWorkflow(workflowKey) ?? CUSTOM;

    // Applying a workflow rewrites the plan. Done on pick, not on every render,
    // so a person's edits survive until they choose a different recipe.
    const applyWorkflow = (next: MeetingWorkflow) => {
        setWorkflowKey(next.key);
        setTitle(next.key === "custom" || next.key === "open-discussion" ? "" : next.title);
        setObjective(next.objectiveTemplate);
        setAgenda(next.agenda.join("\n"));
        const roster = new Set(personas.map(p => p.id));
        const seats = next.agents.filter(key => roster.has(key));
        const extra = (initialSeats ?? []).filter(key => roster.has(key) && !seats.includes(key));
        const room = [...seats, ...extra];
        setSelected(room.length > 0 ? room : personas.slice(0, 3).map(p => p.id));
        setPolicy(next.turnPolicy);
        setModerator(next.moderator && roster.has(next.moderator) ? next.moderator : "");
        const turns = workflowTurnCount(next);
        setMaxTurns(turns > 0 ? turns : 10);
        setUsePhases(next.phases.length > 0);
        setError(null);
    };

    // First open (and each reopen): start from the requested workflow.
    useEffect(() => {
        if (!open) return;
        const key = initialWorkflowKey ?? "decision-review";
        applyWorkflow(meetingWorkflow(key) ?? CUSTOM);
        setShowDetails(false);
        setSlackChannelId("");
        setMirror(false);
        // The roster arrives after open; re-apply once so seats fill in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialWorkflowKey, initialSeats, personas.length]);

    useEffect(() => {
        if (policy === "moderated" && !moderator && selected.length > 0) setModerator(selected[0]!);
    }, [policy, moderator, selected]);

    const defaultAutonomy = isAgentAutonomy(data?.defaults?.autonomy)
        ? data.defaults.autonomy
        : DEFAULT_AGENT_AUTONOMY;
    const roomLevels = useMemo(
        () =>
            selected.map(key =>
                effectiveAutonomy(personas.find(p => p.id === key)?.autonomy, defaultAutonomy)
            ),
        [selected, personas, defaultAutonomy]
    );
    const mirrorProblems = useMemo(
        () =>
            meetingPlanViolations({
                participants: roomLevels,
                slackMirrorEnabled: true,
                slackUseAgentIdentity: true,
            }),
        [roomLevels]
    );
    const mirrorAllowed = mirrorProblems.length === 0;

    const phases: MeetingPhase[] = useMemo(
        () => (usePhases ? phasesForRoom(workflow, selected) : []),
        [workflow, selected, usePhases]
    );
    const phasedTurns = phases.reduce((sum, phase) => sum + phase.turns, 0);

    const canSubmit = title.trim().length > 0 && objective.trim().length > 0 && selected.length > 0;

    const submit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch("/api/collab/meetings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    objective: objective.trim(),
                    agenda: agenda
                        .split("\n")
                        .map(line => line.trim())
                        .filter(Boolean),
                    participantKeys: selected,
                    turnPolicy: policy,
                    moderatorKey: policy === "moderated" ? moderator || undefined : undefined,
                    maxTurns,
                    workflowKey: workflow.key,
                    phases: phases.length > 0 ? phases : undefined,
                    slackChannelId: slackChannelId.trim() || undefined,
                    slackMirrorEnabled: mirror && mirrorAllowed && slackChannelId.trim().length > 0,
                    slackUseAgentIdentity: true,
                    autoStart: true,
                }),
            });
            const body = (await response.json()) as { meeting?: { id: string }; error?: string };
            if (!response.ok || !body.meeting)
                throw new Error(body.error ?? "Could not start the meeting");
            onCreated(body.meeting.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not start the meeting");
        } finally {
            setSubmitting(false);
        }
    };

    const toggleSeat = (key: string) =>
        setSelected(prev => (prev.includes(key) ? prev.filter(id => id !== key) : [...prev, key]));

    return (
        <Dialog open={open} onOpenChange={next => !next && onClose()}>
            <DialogContent className="flex max-h-[min(90vh,940px)] w-[min(860px,calc(100vw-32px))] max-w-none flex-col gap-0 p-0">
                <DialogHeader className="border-line border-b px-6 py-4 text-left">
                    <div className="mono text-ink-3 text-[10px] font-bold uppercase tracking-[0.1em]">
                        New meeting
                    </div>
                    <DialogTitle className="display text-ink text-[22px]">
                        Pick a workflow, choose the room, press start
                    </DialogTitle>
                    <DialogDescription>
                        Everything below is a starting point — change any of it before you begin.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
                    <aside className="border-line bg-panel-2 min-h-0 overflow-y-auto border-r p-3">
                        <div className="mono text-ink-3 px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Workflow
                        </div>
                        <div className="flex flex-col gap-1">
                            {[...MEETING_WORKFLOWS, CUSTOM].map(option => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => applyWorkflow(option)}
                                    aria-pressed={option.key === workflow.key}
                                    className={cn(
                                        "flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                                        option.key === workflow.key
                                            ? "bg-brand-soft text-brand-ink"
                                            : "text-ink-2 hover:bg-line-2"
                                    )}
                                >
                                    <span className="text-[12.5px] font-semibold">
                                        {option.title}
                                    </span>
                                    <span
                                        className={cn(
                                            "text-[11px] leading-snug",
                                            option.key === workflow.key
                                                ? "text-brand-ink/80"
                                                : "text-ink-3"
                                        )}
                                    >
                                        {option.tagline}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </aside>

                    <div className="min-h-0 overflow-y-auto px-6 pb-4 pt-5">
                        {workflow.description && (
                            <p className="text-ink-3 mb-4 mt-0 text-[12.5px] leading-relaxed">
                                {workflow.description}
                            </p>
                        )}

                        <Field label="Title" hint="Becomes the channel name.">
                            <TextInput
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Q3 pricing review"
                                autoFocus
                            />
                        </Field>

                        <Field
                            label="Objective"
                            hint="What the meeting has to produce. Every agent sees this on every turn."
                        >
                            <TextArea
                                value={objective}
                                onChange={e => setObjective(e.target.value)}
                                rows={2}
                                placeholder="Agree a Q3 price change and name who ships it"
                            />
                        </Field>

                        <Field
                            label="In the room"
                            hint={
                                loading
                                    ? "Loading your agents…"
                                    : `${selected.length} selected. Any agent can take a seat; manage the roster in Studio → Agents.`
                            }
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {personas.map(persona => (
                                    <SeatToggle
                                        key={persona.id}
                                        persona={persona}
                                        selected={selected.includes(persona.id)}
                                        suggested={workflow.agents.includes(persona.id)}
                                        onToggle={() => toggleSeat(persona.id)}
                                    />
                                ))}
                                {!loading && personas.length === 0 && (
                                    <span className="text-ink-3 text-[12px]">
                                        No agents yet — add one in Studio → Agents.
                                    </span>
                                )}
                            </div>
                        </Field>

                        {workflow.phases.length > 0 && (
                            <Field
                                label="Phases"
                                hint={
                                    usePhases
                                        ? `${phases.length} phases, ${phasedTurns} turns. The engine keeps each phase to its speakers and goal, and announces the change in the channel.`
                                        : "Off — the turn policy runs the whole meeting."
                                }
                            >
                                <div className="border-line bg-panel-2 rounded-lg border">
                                    <div className="border-line flex items-center gap-2 border-b px-3 py-2">
                                        <Workflow className="text-ink-3 size-3.5" />
                                        <span className="text-ink text-[12.5px] font-semibold">
                                            {workflow.title}
                                        </span>
                                        <div className="flex-1" />
                                        <label className="text-ink-2 flex items-center gap-1.5 text-[12px]">
                                            <input
                                                type="checkbox"
                                                checked={usePhases}
                                                onChange={e => setUsePhases(e.target.checked)}
                                            />
                                            Follow the phases
                                        </label>
                                    </div>
                                    <ol
                                        className={cn(
                                            "m-0 list-none p-0",
                                            !usePhases && "opacity-50"
                                        )}
                                    >
                                        {phasesForRoom(workflow, selected).map((phase, index) => {
                                            const speakers = (phase.speakerIds ?? [])
                                                .map(id => personas.find(p => p.id === id))
                                                .filter((p): p is AgentPersonaRecord => Boolean(p));
                                            return (
                                                <li
                                                    key={phase.id}
                                                    className="border-line flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
                                                >
                                                    <span className="mono text-ink-3 mt-0.5 w-4 text-[10.5px] font-bold">
                                                        {index + 1}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-ink text-[12.5px] font-semibold">
                                                                {phase.title}
                                                            </span>
                                                            <Badge variant="secondary">
                                                                {phase.turns} turn
                                                                {phase.turns === 1 ? "" : "s"}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-ink-3 text-[11.5px] leading-snug">
                                                            {phase.goal}
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 -space-x-1">
                                                        {speakers.length === 0 ? (
                                                            <span className="text-ink-3 text-[10.5px]">
                                                                everyone
                                                            </span>
                                                        ) : (
                                                            speakers.map(p => (
                                                                <AgentAvatar
                                                                    key={p.id}
                                                                    agent={p}
                                                                    size={20}
                                                                    title={p.displayName}
                                                                    className="border-panel-2 rounded-full border-2"
                                                                />
                                                            ))
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                </div>
                            </Field>
                        )}

                        <button
                            type="button"
                            onClick={() => setShowDetails(v => !v)}
                            className="text-ink-2 hover:text-ink mb-3 flex items-center gap-1.5 text-[12.5px] font-medium"
                        >
                            <ArrowRight
                                className={cn(
                                    "size-3.5 transition-transform",
                                    showDetails && "rotate-90"
                                )}
                            />
                            {showDetails ? "Hide" : "Show"} agenda, floor, turn limit and Slack
                        </button>

                        {showDetails && (
                            <>
                                <Field label="Agenda" hint="One item per line. Optional.">
                                    <TextArea
                                        value={agenda}
                                        onChange={e => setAgenda(e.target.value)}
                                        rows={3}
                                        placeholder={
                                            "Current margin\nProposed change\nOwner and timing"
                                        }
                                    />
                                </Field>

                                <Field label="How the floor moves">
                                    <div className="grid gap-1.5">
                                        {TURN_POLICIES.map(option => (
                                            <label
                                                key={option.id}
                                                className={cn(
                                                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2",
                                                    policy === option.id
                                                        ? "border-brand bg-brand-soft"
                                                        : "border-line bg-panel-2"
                                                )}
                                            >
                                                <input
                                                    type="radio"
                                                    name="turn-policy"
                                                    checked={policy === option.id}
                                                    onChange={() => setPolicy(option.id)}
                                                    className="mt-0.5"
                                                />
                                                <span>
                                                    <span className="text-ink block text-[12.5px] font-semibold">
                                                        {option.label}
                                                    </span>
                                                    <span className="text-ink-3 block text-[11.5px]">
                                                        {option.desc}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </Field>

                                {policy === "moderated" && (
                                    <Field label="Chair">
                                        <SelectInput
                                            value={moderator}
                                            onChange={e => setModerator(e.target.value)}
                                        >
                                            {selected.map(key => {
                                                const persona = personas.find(p => p.id === key);
                                                return (
                                                    <option key={key} value={key}>
                                                        {persona?.displayName ?? key} (@{key})
                                                    </option>
                                                );
                                            })}
                                        </SelectInput>
                                    </Field>
                                )}

                                <Field
                                    label="Turn limit"
                                    hint={
                                        phases.length > 0 && maxTurns < phasedTurns
                                            ? `Below the ${phasedTurns} turns the phases add up to — the meeting will stop before the last phase.`
                                            : "A hard stop. The meeting also ends early once the objective is met."
                                    }
                                >
                                    <TextInput
                                        type="number"
                                        min={1}
                                        max={60}
                                        value={maxTurns}
                                        onChange={e =>
                                            setMaxTurns(
                                                Math.max(
                                                    1,
                                                    Math.min(60, Number(e.target.value) || 1)
                                                )
                                            )
                                        }
                                        className="w-28"
                                    />
                                </Field>

                                <Field
                                    label="Slack mirror"
                                    hint={
                                        !data?.slack.canPost
                                            ? `Set ${data?.slack.missing.join(" and ") ?? "SLACK_BOT_TOKEN"} to enable mirroring.`
                                            : !mirrorAllowed
                                              ? mirrorProblems[0]!
                                              : "Turns are posted to this channel, and messages people write there come back here."
                                    }
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-ink-3 flex">
                                            <IconSlack size={15} />
                                        </span>
                                        <TextInput
                                            value={slackChannelId}
                                            onChange={e => setSlackChannelId(e.target.value)}
                                            placeholder="C0123456789"
                                            disabled={!data?.slack.canPost}
                                        />
                                        <label className="text-ink-2 flex items-center gap-1.5 whitespace-nowrap text-[12px]">
                                            <input
                                                type="checkbox"
                                                checked={mirror && mirrorAllowed}
                                                disabled={
                                                    !data?.slack.canPost ||
                                                    slackChannelId.trim().length === 0 ||
                                                    !mirrorAllowed
                                                }
                                                onChange={e => setMirror(e.target.checked)}
                                            />
                                            Mirror
                                        </label>
                                    </div>
                                </Field>
                            </>
                        )}

                        {error && (
                            <div
                                className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-[12.5px]"
                                role="alert"
                            >
                                {error}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="border-line bg-line-2 flex-row items-center border-t px-6 py-3">
                    <span className="text-ink-3 mr-auto inline-flex items-center gap-1.5 text-[11.5px]">
                        <Hash className="size-3" />
                        {title.trim() ? slugPreview(title) : "channel-name"}
                        {selected.length > 0 && (
                            <>
                                <span>·</span>
                                <span>
                                    {selected.length} seat{selected.length === 1 ? "" : "s"} · up to{" "}
                                    {maxTurns} turns
                                </span>
                            </>
                        )}
                    </span>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
                        {submitting ? "Starting…" : "Start meeting"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SeatToggle({
    persona,
    selected,
    suggested,
    onToggle,
}: {
    persona: AgentPersonaRecord;
    selected: boolean;
    suggested: boolean;
    onToggle: () => void;
}) {
    const color = personaColor(persona);
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            title={`${persona.role}${persona.description ? ` — ${persona.description}` : ""}${
                persona.nodeId ? ` · runs on node ${persona.nodeId}` : ""
            }`}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[12px] transition-colors",
                selected ? "bg-panel-2 text-ink" : "text-ink-2 border-line hover:border-ink-3"
            )}
            style={selected ? { borderColor: color } : undefined}
        >
            <AgentAvatar
                agent={persona}
                size={20}
                className={cn(!selected && "opacity-60 grayscale")}
            />
            <span className={cn(selected ? "font-semibold" : "font-medium")}>
                {persona.displayName}
            </span>
            <span className="text-ink-3 text-[10.5px]">{persona.role}</span>
            {suggested && !selected && (
                <span className="text-brand-ink text-[10px]">suggested</span>
            )}
            {persona.nodeId && <Server className="text-ink-3 size-2.5" />}
        </button>
    );
}

function slugPreview(title: string): string {
    return (
        title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 72) || "meeting"
    );
}
