"use client";

import { Check, ChevronDown, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import type { TopicDto } from "../api";
import { canCommitInOneClick } from "../_lib/actions";
import { useVantageFormat } from "../_lib/format";
import { originWords, readyToCommit, topicReason, topicSources } from "../_lib/suggestions";
import { BasisTag, EvidenceChips, StatusWord } from "./Primitives";
import { SuggestionCard, SuggestionMark } from "./Suggestion";

/**
 * A topic in its three lives. Drafted, it is a suggestion card: what it is
 * about, why, from what, and Add to agenda / Ignore on its face. Kept, it
 * is a numbered row on the agenda that carries Vantage's proposed next step
 * as a one-click Commit. Ignored, it waits in a folded list with Restore.
 * The six parts the brief requires — observed facts with sources,
 * interpretation, the decision, the next step, help requested, unknowns —
 * are one click away in each.
 */

export function TopicDetails({ topic }: { topic: TopicDto }) {
    const t = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    return (
        <div className="flex flex-col gap-3.5">
            <Part label={t("whatHappened")} basis="observed">
                {topic.facts.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">{t("noFacts")}</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {topic.facts.map((f, i) => (
                            <li
                                key={i}
                                className="text-ink flex flex-col gap-1 text-[13px] leading-[1.45]"
                            >
                                <span>{f.text}</span>
                                <EvidenceChips refs={f.refs} unsupported={f.unsupported} />
                            </li>
                        ))}
                    </ul>
                )}
            </Part>
            {topic.conflicts.length > 0 && (
                <Part label={t("conflicting")} basis="conflict">
                    <ul className="flex flex-col gap-1.5">
                        {topic.conflicts.map((c, i) => (
                            <li key={i} className="text-ink flex flex-col gap-1 text-[13px]">
                                <span>{c.text}</span>
                                <EvidenceChips refs={c.refs} />
                            </li>
                        ))}
                    </ul>
                </Part>
            )}
            {topic.whyItMatters && (
                <Part label={t("whyDiscuss")} basis="interpretation">
                    <p className="text-ink-2 max-w-[70ch] text-[13px] leading-[1.45]">
                        {topic.whyItMatters}
                    </p>
                </Part>
            )}
            <Part label={t("decision")}>
                <p className="text-ink max-w-[70ch] text-[13px] font-medium leading-[1.45]">
                    {topic.decisionQuestion || (
                        <span className="text-ink-3 font-normal">{t("noDecision")}</span>
                    )}
                </p>
            </Part>
            {(topic.proposedNextStep !== "" ||
                topic.proposedOwner !== null ||
                topic.proposedDue !== null) && (
                <Part label={t("proposedNextStep")} basis="suggestion">
                    <p className="text-ink-2 max-w-[70ch] text-[13px] leading-[1.45]">
                        {topic.proposedNextStep}
                    </p>
                    <div className="text-ink-3 mt-1 flex flex-wrap gap-x-3 text-[12px]">
                        <span>
                            {topic.proposedOwner !== null
                                ? t("owner", { owner: topic.proposedOwner })
                                : t.rich("ownerUnassigned", { em: chunks => <em>{chunks}</em> })}
                        </span>
                        <span>
                            {topic.proposedDue
                                ? t("due", { date: fmt.date(topic.proposedDue) })
                                : t.rich("dueNotSet", { em: chunks => <em>{chunks}</em> })}
                        </span>
                    </div>
                </Part>
            )}
            {topic.helpRequested && (
                <Part label={t("helpRequested")}>
                    <p className="text-ink-2 max-w-[70ch] text-[13px]">{topic.helpRequested}</p>
                    {!topic.shared && (
                        <p className="text-ink-3 mt-1 text-[11.5px]">{t("shareForHelp")}</p>
                    )}
                </Part>
            )}
            {topic.unknowns.length > 0 && (
                <Part label={t("unknown")} basis="unknown">
                    <ul className="text-ink-2 list-disc pl-4 text-[13px]">
                        {topic.unknowns.map((u, i) => (
                            <li key={i}>{u}</li>
                        ))}
                    </ul>
                </Part>
            )}
            {topic.origin !== "founder" && (
                <Part label={t("whyVantage")}>
                    <p className="text-ink-3 max-w-[70ch] text-[12.5px] leading-[1.45]">
                        {topic.rationale ? `${topic.rationale} ` : ""}
                        {t(`originSentence.${topic.origin}`)}
                    </p>
                </Part>
            )}
        </div>
    );
}

function Part({
    label,
    basis,
    children,
}: {
    label: string;
    basis?: "observed" | "interpretation" | "suggestion" | "unknown" | "conflict";
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="mb-1 flex items-center gap-2">
                <span className="text-ink-3 text-[11.5px] font-medium">{label}</span>
                {basis && <BasisTag basis={basis} />}
            </div>
            {children}
        </div>
    );
}

interface TopicMenuActions {
    onEdit?: () => void;
    onDecide?: () => void;
    onMove?: (dir: -1 | 1) => void;
    first?: boolean;
    last?: boolean;
    onShare?: (shared: boolean) => void;
    onIgnore?: () => void;
    onDelete?: () => void;
}

/** Everything else a topic can do, behind ⋯ — the card's face stays two buttons. */
function TopicMenu({ topic, busy, ...a }: TopicMenuActions & { topic: TopicDto; busy: boolean }) {
    const t = useTranslations("vantage.topicCard");
    const tc = useTranslations("common");
    // Not modal: its items open dialogs, and a modal menu that hands off to a
    // dialog leaves the page unclickable once the dialog closes.
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("moreFor", { title: topic.title })}
                    disabled={busy}
                >
                    <MoreHorizontal className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {a.onEdit && (
                    <DropdownMenuItem onSelect={a.onEdit}>{tc("actions.edit")}</DropdownMenuItem>
                )}
                {a.onDecide && (
                    <DropdownMenuItem onSelect={a.onDecide}>
                        {topic.decision ? t("changeDecision") : t("recordDecision")}
                    </DropdownMenuItem>
                )}
                {a.onMove && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => a.onMove?.(-1)} disabled={a.first}>
                            {t("moveUp")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => a.onMove?.(1)} disabled={a.last}>
                            {t("moveDown")}
                        </DropdownMenuItem>
                    </>
                )}
                {(a.onShare ?? a.onIgnore ?? a.onDelete) && <DropdownMenuSeparator />}
                {a.onShare && (
                    <DropdownMenuItem onSelect={() => a.onShare?.(!topic.shared)}>
                        {topic.shared ? t("makePrivate") : t("share")}
                    </DropdownMenuItem>
                )}
                {a.onIgnore && (
                    <DropdownMenuItem onSelect={a.onIgnore}>{t("takeOff")}</DropdownMenuItem>
                )}
                {a.onDelete && (
                    <DropdownMenuItem className="text-danger" onSelect={a.onDelete}>
                        {tc("actions.delete")}
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** A drafted topic, waiting for Add to agenda or Ignore. */
export function TopicSuggestion({
    topic,
    busy = false,
    kicker,
    onKeep,
    onIgnore,
    ...menu
}: TopicMenuActions & {
    topic: TopicDto;
    busy?: boolean;
    kicker?: React.ReactNode;
    onKeep: () => void;
    onIgnore: () => void;
}) {
    const t = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    const { refs, unsupported } = topicSources(topic);
    const hasMenu = Boolean(menu.onEdit ?? menu.onDecide ?? menu.onShare ?? menu.onDelete);
    return (
        <SuggestionCard
            label={topic.title}
            kicker={kicker ?? t("forMeeting")}
            meta={originWords(fmt, topic.origin)}
            title={topic.title}
            reason={topicReason(topic)}
            sources={refs}
            unsupported={unsupported}
            details={<TopicDetails topic={topic} />}
            menu={hasMenu ? <TopicMenu topic={topic} busy={busy} {...menu} /> : undefined}
            actions={
                <>
                    <Button size="sm" onClick={onKeep} disabled={busy}>
                        <Check aria-hidden="true" />
                        {t("addToAgenda")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onIgnore} disabled={busy}>
                        <X aria-hidden="true" />
                        {t("ignore")}
                    </Button>
                </>
            }
        />
    );
}

/**
 * The proposed next step on a kept topic, as a one-click Commit. Vantage's
 * wears the suggestion mark and can be ignored; one the founder wrote is
 * shown plainly as theirs. Without a proposed owner, Commit asks for one in
 * the decision dialog.
 */
export function NextStepSuggestion({
    topic,
    busy = false,
    onCommit,
    onDecide,
    onIgnore,
    className,
}: {
    topic: TopicDto;
    busy?: boolean;
    onCommit: () => void;
    onDecide: () => void;
    onIgnore?: () => void;
    className?: string;
}) {
    const t = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    const oneClick = canCommitInOneClick(topic);
    const theirs = topic.origin === "founder";
    const owner = topic.proposedOwner ?? t("noOwner");
    return (
        <div
            className={cn(
                "border-line-2 flex flex-col gap-2 rounded-lg border px-3 py-2.5",
                theirs ? "bg-panel-2" : "from-brand-soft bg-gradient-to-b to-transparent",
                className
            )}
        >
            {theirs ? (
                <span className="text-ink-3 text-[11.5px] font-medium">{t("yourNextStep")}</span>
            ) : (
                <SuggestionMark>{t("suggestedNextStep")}</SuggestionMark>
            )}
            <div className="text-ink text-[13px] leading-snug">{topic.proposedNextStep}</div>
            <div className="text-ink-3 text-[12px]">
                {topic.proposedDue
                    ? t("ownerBy", { owner, date: fmt.date(topic.proposedDue) })
                    : owner}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={oneClick ? onCommit : onDecide} disabled={busy}>
                    <Check aria-hidden="true" />
                    {oneClick ? t("commit") : t("commitAsk")}
                </Button>
                {onIgnore && !theirs && (
                    <Button size="sm" variant="ghost" onClick={onIgnore} disabled={busy}>
                        <X aria-hidden="true" />
                        {t("ignore")}
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={onDecide} disabled={busy}>
                    {t("decideElse")}
                </Button>
            </div>
        </div>
    );
}

/** A kept topic: numbered, its decision or Vantage's next step under the title. */
export function AgendaTopicRow({
    topic,
    index,
    busy,
    onCommit,
    onDecide,
    nextStepHidden = false,
    onIgnoreNextStep,
    onShowNextStep,
    ...menu
}: TopicMenuActions & {
    topic: TopicDto;
    index: number;
    busy: boolean;
    onCommit: () => void;
    onDecide: () => void;
    /** Vantage's next step was ignored on this browser: offer a plain decision instead. */
    nextStepHidden?: boolean;
    onIgnoreNextStep?: () => void;
    onShowNextStep?: () => void;
}) {
    const t = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    const [open, setOpen] = useState(false);
    const decided = Boolean(topic.decision);
    return (
        <article className="border-line-2 border-t first:border-t-0" aria-label={topic.title}>
            <div className="flex items-start gap-3 px-4 pb-3 pt-3">
                <span className="text-ink-3 mt-0.5 w-5 shrink-0 font-mono text-[12px] tabular-nums">
                    {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-ink text-[14px] font-medium leading-snug">
                                {topic.title}
                            </div>
                            {topic.decisionQuestion && !decided && (
                                <p className="text-ink-2 mt-0.5 text-[12.5px] leading-snug">
                                    {topic.decisionQuestion}
                                </p>
                            )}
                        </div>
                        {decided ? (
                            <StatusWord tone="success" className="mt-0.5">
                                {t("decided")}
                            </StatusWord>
                        ) : (
                            <StatusWord tone="neutral" className="@max-sm:hidden mt-0.5">
                                {t("onAgenda")}
                            </StatusWord>
                        )}
                        {menu.onShare && (
                            <label className="text-ink-3 @max-sm:hidden mt-0.5 inline-flex items-center gap-1.5 text-[11.5px]">
                                <Switch
                                    checked={topic.shared}
                                    onCheckedChange={menu.onShare}
                                    disabled={busy}
                                    aria-label={t("shareAria", { title: topic.title })}
                                />
                                {t("sharedSwitch")}
                            </label>
                        )}
                        <div className="-mr-1.5 -mt-0.5">
                            <TopicMenu topic={topic} busy={busy} onDecide={onDecide} {...menu} />
                        </div>
                    </div>
                    {decided ? (
                        <div className="border-line bg-panel-2 rounded-md border px-3 py-2">
                            <div className="text-ink-3 text-[11.5px]">
                                {t(topic.commitmentId ? "decidedOnOpened" : "decidedOn", {
                                    date: topic.decidedAt ? fmt.date(topic.decidedAt) : "",
                                })}
                            </div>
                            <p className="text-ink text-[13px]">{topic.decision}</p>
                        </div>
                    ) : readyToCommit(topic) && !nextStepHidden ? (
                        <NextStepSuggestion
                            topic={topic}
                            busy={busy}
                            onCommit={onCommit}
                            onDecide={onDecide}
                            onIgnore={onIgnoreNextStep}
                        />
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <Button size="sm" variant="outline" onClick={onDecide} disabled={busy}>
                                {t("recordDecision")}
                            </Button>
                            {readyToCommit(topic) && onShowNextStep && (
                                <button
                                    type="button"
                                    onClick={onShowNextStep}
                                    className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 rounded-sm text-[12px] underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                                >
                                    {t("showNextStep")}
                                </button>
                            )}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                        className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 inline-flex w-fit items-center gap-1 rounded-sm text-[12px] outline-none focus-visible:ring-2"
                    >
                        {open ? t("hideEvidence") : t("evidenceReasoning")}
                        <ChevronDown
                            className={cn(
                                "size-3.5 transition-transform motion-reduce:transition-none",
                                open && "rotate-180"
                            )}
                            aria-hidden="true"
                        />
                    </button>
                    {open && (
                        <div className="border-line-2 border-t pt-3">
                            <TopicDetails topic={topic} />
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

/** An ignored topic, folded away: its title and the way back onto the agenda. */
export function IgnoredTopicRow({
    topic,
    busy,
    onRestore,
    onDelete,
}: {
    topic: TopicDto;
    busy: boolean;
    onRestore: () => void;
    onDelete: () => void;
}) {
    const t = useTranslations("vantage.topicCard");
    const fmt = useVantageFormat();
    return (
        <div className="border-line-2 flex min-h-11 items-center gap-3 border-t px-4 py-2 first:border-t-0">
            <span className="text-ink-2 min-w-0 flex-1 truncate text-[13px]">{topic.title}</span>
            <span className="text-ink-3 @max-sm:hidden text-[11.5px]">
                {originWords(fmt, topic.origin)}
            </span>
            <Button size="sm" variant="outline" onClick={onRestore} disabled={busy}>
                <RotateCcw aria-hidden="true" />
                {t("addToAgenda")}
            </Button>
            <Button
                size="sm"
                variant="ghost"
                className="text-ink-3"
                onClick={onDelete}
                disabled={busy}
                aria-label={t("deleteAria", { title: topic.title })}
            >
                <X aria-hidden="true" />
            </Button>
        </div>
    );
}
