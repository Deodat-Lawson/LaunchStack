"use client";

import { Check, Clock, X } from "lucide-react";

import { SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import type { CommitmentDto, TopicDto } from "../api";
import {
    canCommitInOneClick,
    commitToNextStep,
    ignoreTopic,
    keepTopic,
    markReady,
    resolveCommitment,
    setAside,
    SET_ASIDE_DAYS,
    type Outcome,
} from "../_lib/actions";
import { dueWords, fmtDate, plural, weekRange } from "../_lib/format";
import type { SuggestionGroup, WeekSuggestion } from "../_lib/suggestions";
import { SuggestionCard, SuggestionNudge } from "./Suggestion";
import { TopicDetails, TopicSuggestion } from "./TopicCard";

/**
 * This week's suggestions, in the groups `weekSuggestions` made, each card
 * answered in one click through `act` (see `useOneClick`). The screen owns
 * the dialogs and navigation a few answers lead to.
 */
export function WeekSuggestions({
    groups,
    act,
    gone,
    meetingWeek,
    onDecide,
    onLogEvidence,
    onRecordNumbers,
    onOpenTopic,
    className,
}: {
    groups: SuggestionGroup[];
    act: (id: string, work: () => Promise<Outcome>) => Promise<void>;
    gone: ReadonlySet<string>;
    /** The next meeting's week, for the group heading. */
    meetingWeek?: { start: string; end: string };
    /** Open the decision dialog: a next step without an owner, or a different decision. */
    onDecide: (topic: TopicDto) => void;
    /** For the "log a conversation" nudge; screens without that group leave it out. */
    onLogEvidence?: () => void;
    /** For the "record this week's numbers" nudge. */
    onRecordNumbers?: () => void;
    onOpenTopic?: (topic: TopicDto) => void;
    className?: string;
}) {
    const shown = groups
        .map(g => ({ ...g, items: g.items.filter(s => !gone.has(s.id)) }))
        .filter(g => g.items.length > 0);
    return (
        <div className={cn("flex flex-col gap-6", className)}>
            {shown.map(g => (
                <section key={g.id} aria-label={GROUP_TITLE[g.id]}>
                    <SectionHeading
                        title={
                            g.id === "meeting" && meetingWeek
                                ? `For the meeting · ${weekRange(meetingWeek.start, meetingWeek.end)}`
                                : GROUP_TITLE[g.id]
                        }
                        aside={GROUP_ASIDE[g.id](g.items)}
                    />
                    <div className="flex flex-col gap-2.5">
                        {g.items.map(s => (
                            <Suggestion
                                key={s.id}
                                s={s}
                                act={act}
                                onDecide={onDecide}
                                onLogEvidence={onLogEvidence}
                                onRecordNumbers={onRecordNumbers}
                                onOpenTopic={onOpenTopic}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

const GROUP_TITLE: Record<SuggestionGroup["id"], string> = {
    meeting: "For the meeting",
    "follow-through": "Follow through",
    record: "Keep the record current",
};

const GROUP_ASIDE: Record<SuggestionGroup["id"], (items: WeekSuggestion[]) => string> = {
    meeting: items => {
        const n = items.filter(s => s.kind === "topic").length;
        return n > 0 ? `${plural(n, "topic")} to review` : "ready to go";
    },
    "follow-through": items => `${items.length} to settle`,
    record: () => "so the next draft has more to go on",
};

function Suggestion({
    s,
    act,
    onDecide,
    onLogEvidence,
    onRecordNumbers,
    onOpenTopic,
}: {
    s: WeekSuggestion;
    act: (id: string, work: () => Promise<Outcome>) => Promise<void>;
    onDecide: (topic: TopicDto) => void;
    onLogEvidence?: () => void;
    onRecordNumbers?: () => void;
    onOpenTopic?: (topic: TopicDto) => void;
}) {
    switch (s.kind) {
        case "topic":
            return (
                <TopicSuggestion
                    topic={s.topic}
                    kicker="Suggested for the agenda"
                    onKeep={() => void act(s.id, () => keepTopic(s.topic))}
                    onIgnore={() => void act(s.id, () => ignoreTopic(s.topic))}
                    onEdit={onOpenTopic ? () => onOpenTopic(s.topic) : undefined}
                />
            );
        case "mark-ready":
            return (
                <SuggestionNudge
                    label="Mark the agenda ready"
                    title={
                        <>
                            Every suggestion is answered and{" "}
                            {plural(s.kept, "topic is", "topics are")} on the agenda. Mark it ready
                            for the meeting?
                        </>
                    }
                    actions={
                        <>
                            <Button
                                size="sm"
                                onClick={() => void act(s.id, () => markReady(s.agenda))}
                            >
                                <Check aria-hidden="true" />
                                Mark ready
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(
                                            s.id,
                                            SET_ASIDE_DAYS.snooze,
                                            "Hidden until tomorrow"
                                        )
                                    )
                                }
                            >
                                Not yet
                            </Button>
                        </>
                    }
                />
            );
        case "check-in":
            return (
                <CheckInSuggestion id={s.id} commitment={s.commitment} late={s.late} act={act} />
            );
        case "commit":
            return (
                <CommitSuggestion
                    id={s.id}
                    topic={s.topic}
                    weekStart={s.agenda.weekStart}
                    act={act}
                    onDecide={onDecide}
                />
            );
        case "record-numbers": {
            const names = s.metrics.map(m => m.name);
            const listed =
                names.length <= 2
                    ? names.join(" and ")
                    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
            return (
                <SuggestionNudge
                    label="Record this week's numbers"
                    title={<>No numbers yet this week for {listed}.</>}
                    actions={
                        <>
                            <Button size="sm" onClick={() => onRecordNumbers?.()}>
                                Enter numbers
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(
                                            s.id,
                                            SET_ASIDE_DAYS.nudge,
                                            "Hidden for the rest of the week"
                                        )
                                    )
                                }
                            >
                                <X aria-hidden="true" />
                                Ignore
                            </Button>
                        </>
                    }
                />
            );
        }
        case "log-evidence":
            return (
                <SuggestionNudge
                    label="Log a conversation"
                    title={
                        s.days === null ? (
                            <>
                                Nothing is logged yet. A conversation or a link gives the draft its
                                first source.
                            </>
                        ) : (
                            <>
                                Nothing logged for {plural(s.days, "day")}. Two minutes now makes
                                the next draft worth reading.
                            </>
                        )
                    }
                    actions={
                        <>
                            <Button size="sm" onClick={() => onLogEvidence?.()}>
                                Log a conversation
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(
                                            s.id,
                                            SET_ASIDE_DAYS.nudge,
                                            "Hidden for the rest of the week"
                                        )
                                    )
                                }
                            >
                                <X aria-hidden="true" />
                                Ignore
                            </Button>
                        </>
                    }
                />
            );
    }
}

/** A promise due or overdue, as a question with its answers on the card. */
export function CheckInSuggestion({
    id,
    commitment,
    late,
    act,
}: {
    id: string;
    commitment: CommitmentDto;
    late: boolean;
    act: (id: string, work: () => Promise<Outcome>) => Promise<void>;
}) {
    return (
        <SuggestionCard
            label={`Check in: ${commitment.title}`}
            kicker="Check in"
            meta={<span className={cn(late && "text-warn")}>{dueWords(commitment.dueOn)}</span>}
            title={<>Did &ldquo;{commitment.title}&rdquo; happen?</>}
            reason={
                <>
                    {commitment.owner}
                    {commitment.topicTitle ? ` · from “${commitment.topicTitle}”` : ""}
                    {commitment.test && (
                        <span className="text-ink-3 block">Settled by: {commitment.test}</span>
                    )}
                </>
            }
            actions={
                <>
                    <Button
                        size="sm"
                        onClick={() => void act(id, () => resolveCommitment(commitment, "done"))}
                    >
                        <Check aria-hidden="true" />
                        Done
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void act(id, () => resolveCommitment(commitment, "missed"))}
                    >
                        Missed
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                            void act(id, () =>
                                setAside(id, SET_ASIDE_DAYS.snooze, "Asking again tomorrow")
                            )
                        }
                    >
                        <Clock aria-hidden="true" />
                        Not yet
                    </Button>
                </>
            }
        />
    );
}

/** A held meeting's undecided topic: commit to Vantage's proposed next step. */
export function CommitSuggestion({
    id,
    topic,
    weekStart,
    act,
    onDecide,
}: {
    id: string;
    topic: TopicDto;
    weekStart: string;
    act: (id: string, work: () => Promise<Outcome>) => Promise<void>;
    onDecide: (topic: TopicDto) => void;
}) {
    const oneClick = canCommitInOneClick(topic);
    return (
        <SuggestionCard
            label={`Commit: ${topic.proposedNextStep}`}
            kicker="Suggested next step"
            meta={`From the meeting · week of ${fmtDate(weekStart)}`}
            title={topic.proposedNextStep}
            reason={
                <>
                    {topic.proposedOwner ?? "No owner proposed"}
                    {topic.proposedDue ? ` · by ${fmtDate(topic.proposedDue)}` : ""} · on &ldquo;
                    {topic.title}&rdquo;
                </>
            }
            details={
                <div className="flex flex-col gap-3">
                    <TopicDetails topic={topic} />
                    <div>
                        <Button size="sm" variant="outline" onClick={() => onDecide(topic)}>
                            Decide something else…
                        </Button>
                    </div>
                </div>
            }
            actions={
                <>
                    <Button
                        size="sm"
                        onClick={() =>
                            oneClick ? void act(id, () => commitToNextStep(topic)) : onDecide(topic)
                        }
                    >
                        <Check aria-hidden="true" />
                        {oneClick ? "Commit" : "Commit…"}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                            void act(id, () =>
                                setAside(
                                    id,
                                    SET_ASIDE_DAYS.nextStep,
                                    "Ignored — it stays on the agenda"
                                )
                            )
                        }
                    >
                        <X aria-hidden="true" />
                        Ignore
                    </Button>
                </>
            }
        />
    );
}
