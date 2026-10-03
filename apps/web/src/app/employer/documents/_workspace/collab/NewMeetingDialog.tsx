"use client";

/**
 * Start a meeting: a workflow, the room, the objective — then the details.
 *
 * The dialog is a short path with the recipe up front. Picking a workflow
 * prefills everything (objective, agenda, seats, chair, turn policy, phases),
 * so the fastest path is: pick a workflow, fix the objective's blank, press
 * start. Everything is still editable, and "Open discussion" is a workflow
 * too — the one with no phases.
 *
 * The whole plan is on screen at once: the workflows down the left, the
 * meeting itself (brief, room, phases) in the middle, and how it runs (floor,
 * chair, turn limit, agenda, Slack) on the right. The dialog is a size
 * container and arranges itself by its own width: under 1024px the workflow
 * list becomes a picker at the top of the plan, and under 640px the columns
 * stack into one.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Hash, Server } from "lucide-react";

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
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Field, TextArea, TextInput } from "~/components/field";
import { IconSlack } from "~/components/icons/brand";
import {
    DEFAULT_AGENT_AUTONOMY,
    effectiveAutonomy,
    isAgentAutonomy,
    meetingPlanViolations,
} from "~/lib/agents/autonomy";
import {
    MEETING_WORKFLOWS,
    WORKFLOW_CATEGORY_META,
    meetingWorkflow,
    phasesForRoom,
    workflowTurnCount,
    workflowsByCategory,
    type MeetingWorkflow,
} from "~/lib/agents/meeting-workflows";
import { cn } from "~/lib/utils";

import { useAgents } from "./useMeetings";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentPersonaRecord, MeetingPhase } from "./types";

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

/** A plain "New meeting" opens on the first workflow in the list. */
const DEFAULT_WORKFLOW_KEY = MEETING_WORKFLOWS[0]?.key ?? CUSTOM.key;

const WORKFLOW_GROUPS = workflowsByCategory();

/**
 * Lets a textarea grow with its text where the browser supports it; elsewhere
 * `rows` holds. The kit's own `field-sizing-content` is a Tailwind 4 class
 * this Tailwind 3 build never generates.
 */
const GROWS_WITH_TEXT = "[field-sizing:content]";

export function NewMeetingDialog({
    open,
    onClose,
    onCreated,
    initialWorkflowKey,
    initialSeats,
}: NewMeetingDialogProps) {
    const { data, loading } = useAgents();
    const personas = useMemo(() => data?.personas.filter(p => !p.archived) ?? [], [data]);

    const [workflowKey, setWorkflowKey] = useState<string>(DEFAULT_WORKFLOW_KEY);
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
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const id = useId();
    const railRef = useRef<HTMLElement>(null);

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

    // Picking the workflow that is already applied would wipe the edits to it.
    const pickWorkflow = (next: MeetingWorkflow) => {
        if (next.key !== workflow.key) applyWorkflow(next);
    };

    // First open (and each reopen): start from the requested workflow.
    useEffect(() => {
        if (!open) return;
        const key = initialWorkflowKey ?? DEFAULT_WORKFLOW_KEY;
        applyWorkflow(meetingWorkflow(key) ?? CUSTOM);
        setSlackChannelId("");
        setMirror(false);
        // The roster arrives after open; re-apply once so seats fill in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialWorkflowKey, initialSeats, personas.length]);

    // A moderated meeting needs a chair, and the chair has to be in the room.
    useEffect(() => {
        if (policy !== "moderated" || selected.length === 0) return;
        if (!selected.includes(moderator)) setModerator(selected[0]!);
    }, [policy, moderator, selected]);

    // Opened on a workflow further down the list: bring it into view.
    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => {
            // Optional call as well as optional chain: jsdom has no scrollIntoView.
            railRef.current
                ?.querySelector<HTMLElement>('[aria-pressed="true"]')
                ?.scrollIntoView?.({ block: "nearest" });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, workflow.key]);

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

    const missing = [
        !title.trim() && "a title",
        !objective.trim() && "an objective",
        selected.length === 0 && "someone to the room",
    ].filter((item): item is string => Boolean(item));
    const canSubmit = missing.length === 0;

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

    const summary = [
        `${selected.length} seat${selected.length === 1 ? "" : "s"}`,
        phases.length > 0 && `${phases.length} phases`,
        `up to ${maxTurns} turns`,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <Dialog open={open} onOpenChange={next => !next && onClose()}>
            {/* The kit caps a dialog at `sm:max-w-lg`; this one sizes itself
                and is the container its `@max-*` variants measure. */}
            <DialogContent className="flex h-[min(88vh,860px)] w-[min(1200px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 [container-type:inline-size] sm:max-w-none">
                <DialogHeader className="border-line @max-sm:px-4 gap-1 border-b px-5 py-4 pr-14 text-left">
                    <DialogTitle className="display text-ink text-[18px]">New meeting</DialogTitle>
                    <DialogDescription className="text-[12.5px] leading-snug">
                        Pick a workflow, choose who&apos;s in the room, and press start. The
                        workflow fills in the rest — change any of it first.
                    </DialogDescription>
                </DialogHeader>

                <div className="@max-md:flex-col @max-md:overflow-y-auto flex min-h-0 flex-1">
                    {/* The shared container variants stop at @max-md (639px);
                        the list keeps its column only in a 1024px dialog, and
                        below that the picker at the top of the plan stands in.
                        Each side only ever hides: UploadThing's stylesheet,
                        loaded after ours, re-declares `hidden` (and `px-6`,
                        `m-0`, …), so a variant that shows would lose to it. */}
                    <WorkflowRail
                        navRef={railRef}
                        current={workflow.key}
                        onPick={pickWorkflow}
                        className="[@container(max-width:1023px)]:hidden"
                    />

                    <div className="@max-md:flex-none @max-md:overflow-visible @max-sm:px-4 min-w-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
                        <div className="border-line mb-5 border-b pb-5">
                            <h3 className="text-ink text-[16px] font-semibold [@container(max-width:1023px)]:hidden">
                                {workflow.title}
                            </h3>
                            <div className="[@container(min-width:1024px)]:hidden">
                                <Label
                                    htmlFor={`${id}-workflow`}
                                    className="text-ink-2 mb-1.5 text-xs font-semibold"
                                >
                                    Workflow
                                </Label>
                                <WorkflowPicker
                                    id={`${id}-workflow`}
                                    current={workflow.key}
                                    onPick={pickWorkflow}
                                />
                            </div>
                            <p className="text-ink-3 mt-1.5 text-[12.5px] leading-relaxed">
                                {workflow.description || workflow.tagline}
                            </p>
                            {workflow.basis && (
                                <div
                                    className="text-ink-3 mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug"
                                    title={`${workflow.basis.origin} Used by: ${workflow.basis.usedBy}`}
                                >
                                    <BookOpen className="mt-px size-3 shrink-0" aria-hidden />
                                    <span>
                                        <span className="text-ink-2 font-medium">
                                            {workflow.basis.name}
                                        </span>
                                        {" · "}
                                        {workflow.basis.usedBy}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Side by side while both fit; the objective wraps
                            under the title in a narrow plan. */}
                        <div className="flex flex-wrap gap-x-4">
                            <div className="min-w-0 flex-[2_1_200px]">
                                <Field
                                    label="Title"
                                    hint="Becomes the channel name."
                                    htmlFor={`${id}-title`}
                                >
                                    <TextInput
                                        id={`${id}-title`}
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        placeholder="Q3 pricing review"
                                        autoFocus
                                    />
                                </Field>
                            </div>
                            <div className="min-w-0 flex-[3_1_300px]">
                                <Field
                                    label="Objective"
                                    hint="What the meeting has to produce. Every agent sees it on every turn."
                                    htmlFor={`${id}-objective`}
                                >
                                    <TextArea
                                        id={`${id}-objective`}
                                        value={objective}
                                        onChange={e => setObjective(e.target.value)}
                                        rows={3}
                                        placeholder="Agree a Q3 price change and name who ships it"
                                        className={cn(
                                            "max-h-[200px] min-h-[76px]",
                                            GROWS_WITH_TEXT
                                        )}
                                    />
                                </Field>
                            </div>
                        </div>

                        <Section
                            title="In the room"
                            meta={
                                loading
                                    ? "Loading your agents…"
                                    : `${selected.length} of ${personas.length} seated`
                            }
                            className="mt-2"
                        >
                            {personas.length > 0 ? (
                                <>
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2">
                                        {personas.map(persona => (
                                            <SeatCard
                                                key={persona.id}
                                                persona={persona}
                                                selected={selected.includes(persona.id)}
                                                suggested={workflow.agents.includes(persona.id)}
                                                chair={
                                                    policy === "moderated" &&
                                                    moderator === persona.id
                                                }
                                                onToggle={() => toggleSeat(persona.id)}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-ink-3 mt-2 text-[11px] leading-normal">
                                        Any agent can take a seat; manage the roster in Studio →
                                        Agents.
                                    </p>
                                </>
                            ) : (
                                !loading && (
                                    <p className="text-ink-3 text-[12px]">
                                        No agents yet — add one in Studio → Agents.
                                    </p>
                                )
                            )}
                        </Section>

                        {workflow.phases.length > 0 && (
                            <Section
                                title="Phases"
                                meta={
                                    usePhases
                                        ? `${phases.length} phases · ${phasedTurns} turns`
                                        : "Off"
                                }
                                action={
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id={`${id}-phases`}
                                            checked={usePhases}
                                            onCheckedChange={setUsePhases}
                                        />
                                        <Label
                                            htmlFor={`${id}-phases`}
                                            className="text-ink-2 text-[12px] font-medium"
                                        >
                                            Follow the phases
                                        </Label>
                                    </div>
                                }
                            >
                                <ol
                                    className={cn(
                                        "border-line list-none rounded-lg border p-0 transition-opacity",
                                        !usePhases && "opacity-50"
                                    )}
                                >
                                    {phasesForRoom(workflow, selected).map((phase, index) => (
                                        <PhaseRow
                                            key={phase.id}
                                            phase={phase}
                                            index={index}
                                            personas={personas}
                                        />
                                    ))}
                                </ol>
                                <p className="text-ink-3 mt-2 text-[11px] leading-normal">
                                    {usePhases
                                        ? "The engine keeps each phase to its speakers and goal, and announces the change in the channel."
                                        : "Off — the turn policy runs the whole meeting."}
                                </p>
                            </Section>
                        )}
                    </div>

                    <aside
                        aria-labelledby={`${id}-runs`}
                        className="bg-panel-2 border-line @max-md:w-auto @max-md:flex-none @max-md:overflow-visible @max-md:border-l-0 @max-md:border-t @max-sm:px-4 w-[300px] shrink-0 overflow-y-auto border-l px-5 pb-6 pt-5"
                    >
                        <h3 id={`${id}-runs`} className="text-ink mb-4 text-[13px] font-semibold">
                            How it runs
                        </h3>

                        <Field label="Who speaks next">
                            <RadioGroup
                                value={policy}
                                onValueChange={value => {
                                    const option = TURN_POLICIES.find(p => p.id === value);
                                    if (option) setPolicy(option.id);
                                }}
                                aria-label="Who speaks next"
                                className="gap-1.5"
                            >
                                {TURN_POLICIES.map(option => (
                                    <label
                                        key={option.id}
                                        htmlFor={`${id}-policy-${option.id}`}
                                        className={cn(
                                            "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                                            policy === option.id
                                                ? "border-brand bg-brand-soft"
                                                : "border-line bg-panel hover:border-ink-3"
                                        )}
                                    >
                                        <RadioGroupItem
                                            id={`${id}-policy-${option.id}`}
                                            value={option.id}
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="text-ink block text-[12.5px] font-semibold">
                                                {option.label}
                                            </span>
                                            <span className="text-ink-3 block text-[11.5px] leading-snug">
                                                {option.desc}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </RadioGroup>
                        </Field>

                        {policy === "moderated" && (
                            <Field label="Chair" htmlFor={`${id}-chair`}>
                                <Select
                                    value={moderator}
                                    onValueChange={setModerator}
                                    disabled={selected.length === 0}
                                >
                                    <SelectTrigger id={`${id}-chair`} className="bg-panel">
                                        <SelectValue placeholder="Seat someone first" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selected.map(key => {
                                            const persona = personas.find(p => p.id === key);
                                            return (
                                                <SelectItem key={key} value={key}>
                                                    {/* One wrapper, so the trigger lays it out
                                                        the same as the list does. */}
                                                    <span className="flex min-w-0 items-center gap-2">
                                                        {persona && (
                                                            <AgentAvatar
                                                                agent={persona}
                                                                size={18}
                                                            />
                                                        )}
                                                        <span className="truncate">
                                                            {persona?.displayName ?? key}
                                                        </span>
                                                        <span className="text-ink-3">@{key}</span>
                                                    </span>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </Field>
                        )}

                        <Field
                            label="Turn limit"
                            hint={
                                phases.length > 0 && maxTurns < phasedTurns
                                    ? `Below the ${phasedTurns} turns the phases add up to — the meeting will stop before the last phase.`
                                    : "A hard stop. The meeting also ends early once the objective is met."
                            }
                            htmlFor={`${id}-turns`}
                        >
                            <TextInput
                                id={`${id}-turns`}
                                type="number"
                                min={1}
                                max={60}
                                value={maxTurns}
                                onChange={e =>
                                    setMaxTurns(
                                        Math.max(1, Math.min(60, Number(e.target.value) || 1))
                                    )
                                }
                                className="bg-panel w-24"
                            />
                        </Field>

                        <Field
                            label="Agenda"
                            hint="One item per line. Optional."
                            htmlFor={`${id}-agenda`}
                        >
                            <TextArea
                                id={`${id}-agenda`}
                                value={agenda}
                                onChange={e => setAgenda(e.target.value)}
                                rows={5}
                                placeholder={"Current margin\nProposed change\nOwner and timing"}
                                className={cn(
                                    "bg-panel max-h-[260px] min-h-[88px]",
                                    GROWS_WITH_TEXT
                                )}
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
                            htmlFor={`${id}-slack`}
                        >
                            <div className="relative">
                                <span className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2">
                                    <IconSlack size={14} />
                                </span>
                                <TextInput
                                    id={`${id}-slack`}
                                    value={slackChannelId}
                                    onChange={e => setSlackChannelId(e.target.value)}
                                    placeholder="Channel ID, e.g. C0123456789"
                                    disabled={!data?.slack.canPost}
                                    className="bg-panel pl-8"
                                />
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <Switch
                                    id={`${id}-mirror`}
                                    checked={mirror && mirrorAllowed}
                                    disabled={
                                        !data?.slack.canPost ||
                                        slackChannelId.trim().length === 0 ||
                                        !mirrorAllowed
                                    }
                                    onCheckedChange={setMirror}
                                />
                                <Label
                                    htmlFor={`${id}-mirror`}
                                    className="text-ink-2 text-[12px] font-medium"
                                >
                                    Mirror the meeting to this channel
                                </Label>
                            </div>
                        </Field>
                    </aside>
                </div>

                {error && (
                    <div
                        className="bg-danger-soft text-danger border-line @max-sm:px-4 border-t px-5 py-2 text-[12.5px]"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <DialogFooter className="border-line bg-line-2 @max-sm:px-4 flex-row items-center gap-2 border-t px-5 py-3">
                    <div className="text-ink-3 mr-auto flex min-w-0 items-center gap-1.5 text-[11.5px]">
                        {canSubmit ? (
                            <>
                                <Hash className="size-3 shrink-0" aria-hidden />
                                <span className="truncate">{slugPreview(title)}</span>
                                <span className="@max-sm:hidden shrink-0">· {summary}</span>
                            </>
                        ) : (
                            <span className="truncate">Add {listPhrase(missing)} to start.</span>
                        )}
                    </div>
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

/** The workflows under their headings, for a dialog wide enough to list them. */
function WorkflowRail({
    navRef,
    current,
    onPick,
    className,
}: {
    navRef: React.Ref<HTMLElement>;
    current: string;
    onPick: (workflow: MeetingWorkflow) => void;
    className?: string;
}) {
    return (
        <nav
            ref={navRef}
            aria-label="Workflows"
            className={cn(
                "bg-panel-2 border-line w-[248px] shrink-0 overflow-y-auto border-r px-2 py-3",
                className
            )}
        >
            {WORKFLOW_GROUPS.map(([category, workflows]) => (
                <div key={category} className="mb-3">
                    <div className="mono text-ink-3 px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.1em]">
                        {WORKFLOW_CATEGORY_META[category].label}
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {workflows.map(option => (
                            <RailItem
                                key={option.key}
                                workflow={option}
                                active={option.key === current}
                                onPick={onPick}
                            />
                        ))}
                    </div>
                </div>
            ))}
            <div className="border-line mx-2.5 mb-2 border-t" />
            <RailItem workflow={CUSTOM} active={current === CUSTOM.key} onPick={onPick} />
        </nav>
    );
}

function RailItem({
    workflow,
    active,
    onPick,
}: {
    workflow: MeetingWorkflow;
    active: boolean;
    onPick: (workflow: MeetingWorkflow) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onPick(workflow)}
            aria-pressed={active}
            className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                "focus-visible:ring-brand/50 outline-none focus-visible:ring-[3px]",
                active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-line-2"
            )}
        >
            <span className="text-[12.5px] font-semibold">{workflow.title}</span>
            <span
                className={cn(
                    "text-[11px] leading-snug",
                    active ? "text-brand-ink/80" : "text-ink-3"
                )}
            >
                {workflow.tagline}
            </span>
        </button>
    );
}

/** The same choice as the rail, for a dialog too narrow to give it a column. */
function WorkflowPicker({
    id,
    current,
    onPick,
}: {
    id: string;
    current: string;
    onPick: (workflow: MeetingWorkflow) => void;
}) {
    return (
        <Select value={current} onValueChange={key => onPick(meetingWorkflow(key) ?? CUSTOM)}>
            <SelectTrigger id={id} className="bg-panel w-full max-w-[360px]">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {WORKFLOW_GROUPS.map(([category, workflows]) => (
                    <SelectGroup key={category}>
                        <SelectLabel>{WORKFLOW_CATEGORY_META[category].label}</SelectLabel>
                        {workflows.map(option => (
                            <SelectItem key={option.key} value={option.key}>
                                {option.title}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                ))}
                <SelectSeparator />
                <SelectItem value={CUSTOM.key}>{CUSTOM.title}</SelectItem>
            </SelectContent>
        </Select>
    );
}

function Section({
    title,
    meta,
    action,
    className,
    children,
}: {
    title: string;
    meta?: string;
    action?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    const headingId = useId();
    return (
        <section aria-labelledby={headingId} className={cn("mt-6", className)}>
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 id={headingId} className="text-ink text-[13px] font-semibold">
                    {title}
                </h3>
                {meta && <span className="text-ink-3 text-[11.5px]">{meta}</span>}
                {action && <div className="ml-auto">{action}</div>}
            </div>
            {children}
        </section>
    );
}

function SeatCard({
    persona,
    selected,
    suggested,
    chair,
    onToggle,
}: {
    persona: AgentPersonaRecord;
    selected: boolean;
    suggested: boolean;
    chair: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            title={`${persona.role}${persona.description ? ` — ${persona.description}` : ""}${
                persona.nodeId ? ` · runs on node ${persona.nodeId}` : ""
            }`}
            className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                "focus-visible:ring-brand/50 outline-none focus-visible:ring-[3px]",
                selected ? "border-brand bg-brand-soft" : "border-line bg-panel hover:border-ink-3"
            )}
        >
            <AgentAvatar
                agent={persona}
                size={28}
                className={cn(!selected && "opacity-60 grayscale")}
            />
            <span className="min-w-0 flex-1">
                <span
                    className={cn(
                        "block truncate text-[12.5px]",
                        selected ? "text-ink font-semibold" : "text-ink-2 font-medium"
                    )}
                >
                    {persona.displayName}
                </span>
                <span className="text-ink-3 block truncate text-[11px]">
                    {chair && <span className="text-brand-ink font-medium">Chair · </span>}
                    {persona.role}
                    {suggested && !selected && <span className="text-brand-ink"> · suggested</span>}
                </span>
            </span>
            {persona.nodeId && <Server className="text-ink-3 size-3 shrink-0" aria-hidden />}
            <span
                aria-hidden
                className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-brand bg-brand text-brand-fg" : "border-line"
                )}
            >
                {selected && <Check className="size-3" strokeWidth={3} />}
            </span>
        </button>
    );
}

function PhaseRow({
    phase,
    index,
    personas,
}: {
    phase: MeetingPhase;
    index: number;
    personas: AgentPersonaRecord[];
}) {
    const speakers = (phase.speakerIds ?? [])
        .map(id => personas.find(p => p.id === id))
        .filter((p): p is AgentPersonaRecord => Boolean(p));
    return (
        <li className="border-line flex items-start gap-3 border-b px-3 py-2.5 last:border-b-0">
            <span className="mono bg-line-2 text-ink-2 mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold">
                {index + 1}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-ink text-[12.5px] font-semibold">{phase.title}</span>
                    <Badge variant="secondary">
                        {phase.turns} turn{phase.turns === 1 ? "" : "s"}
                    </Badge>
                </div>
                <p className="text-ink-3 mt-0.5 text-[11.5px] leading-snug">{phase.goal}</p>
            </div>
            <div className="flex shrink-0 -space-x-1 pt-px">
                {speakers.length === 0 ? (
                    <span className="text-ink-3 text-[10.5px]">everyone</span>
                ) : (
                    speakers.map(p => (
                        <AgentAvatar
                            key={p.id}
                            agent={p}
                            size={20}
                            title={p.displayName}
                            className="border-surface rounded-full border-2"
                        />
                    ))
                )}
            </div>
        </li>
    );
}

/** "a title", "a title and an objective", "a, b and c". */
function listPhrase(items: string[]): string {
    if (items.length <= 1) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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
