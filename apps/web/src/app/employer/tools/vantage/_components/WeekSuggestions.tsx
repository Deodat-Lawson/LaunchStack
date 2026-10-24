"use client";

import { Check, Clock, X } from "lucide-react";
import { useTranslations } from "next-intl";

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
import { useVantageFormat } from "../_lib/format";
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
    const t = useTranslations("vantage.weekSuggestions");
    const fmt = useVantageFormat();
    const shown = groups
        .map(g => ({ ...g, items: g.items.filter(s => !gone.has(s.id)) }))
        .filter(g => g.items.length > 0);
    const aside = (g: SuggestionGroup) => {
        switch (g.id) {
            case "meeting": {
                const n = g.items.filter(s => s.kind === "topic").length;
                return n > 0 ? t("aside.topics", { count: n }) : t("aside.ready");
            }
            case "follow-through":
                return t("aside.toSettle", { count: g.items.length });
            case "record":
                return t("aside.record");
        }
    };
    return (
        <div className={cn("flex flex-col gap-6", className)}>
            {shown.map(g => (
                <section key={g.id} aria-label={t(`group.${GROUP_KEY[g.id]}`)}>
                    <SectionHeading
                        title={
                            g.id === "meeting" && meetingWeek
                                ? t("meetingWithWeek", {
                                      range: fmt.weekRange(meetingWeek.start, meetingWeek.end),
                                  })
                                : t(`group.${GROUP_KEY[g.id]}`)
                        }
                        aside={aside(g)}
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

const GROUP_KEY: Record<SuggestionGroup["id"], "meeting" | "followThrough" | "record"> = {
    meeting: "meeting",
    "follow-through": "followThrough",
    record: "record",
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
    const t = useTranslations("vantage.weekSuggestions");
    const fmt = useVantageFormat();
    switch (s.kind) {
        case "topic":
            return (
                <TopicSuggestion
                    topic={s.topic}
                    kicker={t("suggestedForAgenda")}
                    onKeep={() => void act(s.id, () => keepTopic(fmt, s.topic))}
                    onIgnore={() => void act(s.id, () => ignoreTopic(fmt, s.topic))}
                    onEdit={onOpenTopic ? () => onOpenTopic(s.topic) : undefined}
                />
            );
        case "mark-ready":
            return (
                <SuggestionNudge
                    label={t("markReadyLabel")}
                    title={t("markReadyTitle", { count: s.kept })}
                    actions={
                        <>
                            <Button
                                size="sm"
                                onClick={() => void act(s.id, () => markReady(fmt, s.agenda))}
                            >
                                <Check aria-hidden="true" />
                                {t("markReady")}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(s.id, SET_ASIDE_DAYS.snooze, t("hiddenTomorrow"))
                                    )
                                }
                            >
                                {t("notYet")}
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
                    ? fmt.list(names)
                    : t("namesMore", {
                          names: names.slice(0, 2).join(fmt.t("format.list.separator")),
                          count: names.length - 2,
                      });
            return (
                <SuggestionNudge
                    label={t("recordNumbersLabel")}
                    title={t("noNumbers", { names: listed })}
                    actions={
                        <>
                            <Button size="sm" onClick={() => onRecordNumbers?.()}>
                                {t("enterNumbers")}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(s.id, SET_ASIDE_DAYS.nudge, t("hiddenWeek"))
                                    )
                                }
                            >
                                <X aria-hidden="true" />
                                {t("ignore")}
                            </Button>
                        </>
                    }
                />
            );
        }
        case "log-evidence":
            return (
                <SuggestionNudge
                    label={t("logConversation")}
                    title={
                        s.days === null
                            ? t("nothingLogged")
                            : t("nothingLoggedFor", { count: s.days })
                    }
                    actions={
                        <>
                            <Button size="sm" onClick={() => onLogEvidence?.()}>
                                {t("logConversation")}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void act(s.id, () =>
                                        setAside(s.id, SET_ASIDE_DAYS.nudge, t("hiddenWeek"))
                                    )
                                }
                            >
                                <X aria-hidden="true" />
                                {t("ignore")}
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
    const t = useTranslations("vantage.weekSuggestions");
    const fmt = useVantageFormat();
    return (
        <SuggestionCard
            label={t("checkInLabel", { title: commitment.title })}
            kicker={t("checkIn")}
            meta={<span className={cn(late && "text-warn")}>{fmt.due(commitment.dueOn)}</span>}
            title={t("didItHappen", { title: commitment.title })}
            reason={
                <>
                    {commitment.topicTitle
                        ? t("ownerFrom", { owner: commitment.owner, topic: commitment.topicTitle })
                        : commitment.owner}
                    {commitment.test && (
                        <span className="text-ink-3 block">
                            {t("settledBy", { test: commitment.test })}
                        </span>
                    )}
                </>
            }
            actions={
                <>
                    <Button
                        size="sm"
                        onClick={() =>
                            void act(id, () => resolveCommitment(fmt, commitment, "done"))
                        }
                    >
                        <Check aria-hidden="true" />
                        {t("done")}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                            void act(id, () => resolveCommitment(fmt, commitment, "missed"))
                        }
                    >
                        {t("missed")}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                            void act(id, () =>
                                setAside(id, SET_ASIDE_DAYS.snooze, t("askingTomorrow"))
                            )
                        }
                    >
                        <Clock aria-hidden="true" />
                        {t("notYet")}
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
    const t = useTranslations("vantage.weekSuggestions");
    const tt = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    const oneClick = canCommitInOneClick(topic);
    const owner = topic.proposedOwner ?? tt("noOwner");
    return (
        <SuggestionCard
            label={t("commitLabel", { step: topic.proposedNextStep })}
            kicker={tt("suggestedNextStep")}
            meta={t("fromMeeting", { date: fmt.date(weekStart) })}
            title={topic.proposedNextStep}
            reason={
                topic.proposedDue
                    ? t("commitReasonDue", {
                          owner,
                          date: fmt.date(topic.proposedDue),
                          title: topic.title,
                      })
                    : t("commitReason", { owner, title: topic.title })
            }
            details={
                <div className="flex flex-col gap-3">
                    <TopicDetails topic={topic} />
                    <div>
                        <Button size="sm" variant="outline" onClick={() => onDecide(topic)}>
                            {tt("decideElse")}
                        </Button>
                    </div>
                </div>
            }
            actions={
                <>
                    <Button
                        size="sm"
                        onClick={() =>
                            oneClick
                                ? void act(id, () => commitToNextStep(fmt, topic))
                                : onDecide(topic)
                        }
                    >
                        <Check aria-hidden="true" />
                        {oneClick ? tt("commit") : tt("commitAsk")}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                            void act(id, () =>
                                setAside(id, SET_ASIDE_DAYS.nextStep, t("ignoredStays"))
                            )
                        }
                    >
                        <X aria-hidden="true" />
                        {t("ignore")}
                    </Button>
                </>
            }
        />
    );
}
