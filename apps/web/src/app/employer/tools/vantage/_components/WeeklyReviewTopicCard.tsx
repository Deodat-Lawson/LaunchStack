"use client";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CalendarDays, ChevronDown, Sparkles, UserRound } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import { ReviewCitationChips, type ReviewSource } from "./ReviewCitationChips";
import { useVantageFormat } from "../_lib/format";
import type { WeeklyReviewContextDto, WeeklyReviewDto } from "../api";
import s from "./review-layout.module.css";

type Topic = WeeklyReviewDto["report"]["topics"][number];
export function WeeklyReviewTopicCard({
    topic,
    number,
    open,
    onOpenChange,
    decisions,
    draft,
    onDraft,
    onReset,
    onRecord,
    saving,
    disabled,
    error,
    sources,
    documents,
    onInspect,
}: {
    topic: Topic;
    number: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    decisions: WeeklyReviewDto["decisions"];
    draft: string | undefined;
    onDraft: (text: string) => void;
    onReset: () => void;
    onRecord: () => void;
    saving: boolean;
    disabled: boolean;
    error?: string;
    sources: ReviewSource[];
    documents?: WeeklyReviewContextDto["documents"];
    onInspect: (ref: string) => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const fmt = useVantageFormat();
    const id = useId();
    const [editing, setEditing] = useState(false);
    const [evidenceOpen, setEvidenceOpen] = useState(false);
    const versions = decisions
        .filter(item => item.topicId === topic.id)
        .sort((a, b) => b.version - a.version);
    const latest = versions[0];
    const latestVersion = latest?.version;
    useEffect(() => {
        setEditing(false);
    }, [latestVersion]);
    const recommendation = topic.recommendation;
    const suggested = !latest && Boolean(recommendation) && draft === undefined;
    const text = draft ?? (!latest ? (recommendation?.call ?? "") : latest.decision);
    const showEditor = !latest || editing || draft !== undefined;
    const status = t(latest ? "founder.decided" : "founder.needsDecision");
    const statusBadge = (
        <Badge className={s.statusBadge} data-decided={Boolean(latest)}>
            {status}
        </Badge>
    );
    return (
        <Collapsible
            open={open}
            onOpenChange={onOpenChange}
            className={s.topic}
            data-testid={`review-topic-${topic.id}`}
        >
            <CollapsibleTrigger asChild>
                <Button
                    variant="ghost"
                    className={s.topicTrigger}
                    aria-label={t("founder.topicNumber", {
                        number,
                        question: topic.decisionQuestion,
                    })}
                >
                    <span className={s.topicNumber} aria-hidden="true">
                        {number}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                        <span className={cn("block", open ? s.label : s.body)}>
                            {open ? topic.title : topic.decisionQuestion}
                        </span>
                        {!open && latest ? (
                            <span className={cn("block truncate", s.label)}>
                                {latest.decision.split(/\r?\n/)[0]}
                            </span>
                        ) : null}
                    </span>
                    {statusBadge}
                    <ChevronDown
                        aria-hidden="true"
                        className={cn(
                            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                            open && "rotate-180"
                        )}
                    />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent
                forceMount
                aria-hidden={!open}
                inert={!open}
                className={s.accordionContent}
            >
                <div className={cn(s.topicBody, "space-y-4")}>
                    <h2 className={cn(s.heading, s.prose)}>{topic.decisionQuestion}</h2>
                    <section className={s.decisionBlock} data-suggested={suggested}>
                        {showEditor ? (
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    {suggested ? (
                                        <Sparkles
                                            aria-hidden="true"
                                            className="text-brand size-4"
                                        />
                                    ) : null}
                                    <Label htmlFor={id} className={s.label}>
                                        {t(
                                            suggested
                                                ? "founder.suggestedDecision"
                                                : "founder.decisionDraft"
                                        )}
                                    </Label>
                                    {suggested && recommendation ? (
                                        <Badge variant="outline" className={s.label}>
                                            {t("founder.confidence", {
                                                level: t(
                                                    `founder.confidenceLevel.${recommendation.confidence}`
                                                ),
                                            })}
                                        </Badge>
                                    ) : null}
                                    {!latest && recommendation && draft !== undefined ? (
                                        <Button
                                            type="button"
                                            variant="link"
                                            size="sm"
                                            className="ml-auto h-auto p-0"
                                            disabled={disabled || saving}
                                            onClick={onReset}
                                        >
                                            {t("founder.resetSuggestion")}
                                        </Button>
                                    ) : null}
                                </div>
                                <Textarea
                                    id={id}
                                    placeholder={t("founder.decisionPlaceholder")}
                                    value={text}
                                    onChange={event => onDraft(event.target.value)}
                                    maxLength={2000}
                                    disabled={disabled}
                                />
                            </div>
                        ) : latest ? (
                            <div className="space-y-3">
                                <h3 className={s.label}>{t("founder.humanDecision")}</h3>
                                <p className={cn(s.prose, "whitespace-pre-wrap")}>
                                    {latest.decision}
                                </p>
                                <p className={s.label}>
                                    {t("founder.decisionVersion", {
                                        version: latest.version,
                                        date: fmt.dateTime(latest.recordedAt),
                                    })}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={disabled}
                                    onClick={() => {
                                        onDraft(latest.decision);
                                        setEditing(true);
                                    }}
                                >
                                    {t("founder.changeDecision")}
                                </Button>
                            </div>
                        ) : null}
                        {error ? (
                            <p role="alert" className="text-danger mt-3">
                                {error}
                            </p>
                        ) : null}
                    </section>
                    {recommendation ? (
                        <ReviewCitationChips
                            refs={recommendation.refs}
                            sources={sources}
                            documents={documents}
                            onInspect={onInspect}
                        />
                    ) : null}
                    <dl className={s.meta}>
                        {topic.proposedNextStep ? (
                            <div className="min-w-40 flex-1">
                                <ArrowRight aria-hidden="true" />
                                <dt className="sr-only">{t("founder.nextStep")}</dt>
                                <dd>{topic.proposedNextStep}</dd>
                            </div>
                        ) : null}
                        {topic.proposedOwner ? (
                            <div>
                                <UserRound aria-hidden="true" />
                                <dt className="sr-only">{t("founder.owner")}</dt>
                                <dd>{topic.proposedOwner}</dd>
                            </div>
                        ) : null}
                        {topic.proposedDue ? (
                            <div>
                                <CalendarDays aria-hidden="true" />
                                <dt className="sr-only">{t("founder.due")}</dt>
                                <dd>{fmt.date(topic.proposedDue)}</dd>
                            </div>
                        ) : null}
                    </dl>
                    <div className={s.actionRow}>
                        {showEditor ? (
                            <Button
                                disabled={disabled || saving || !text.trim()}
                                onClick={onRecord}
                            >
                                {t(
                                    saving
                                        ? "founder.savingDecision"
                                        : suggested
                                          ? "founder.confirmDecision"
                                          : "founder.recordDecision"
                                )}
                            </Button>
                        ) : null}
                        <Button
                            variant="ghost"
                            className={cn(s.evidenceToggle, "gap-2")}
                            aria-expanded={evidenceOpen}
                            aria-controls={id + "-evidence"}
                            onClick={() => setEvidenceOpen(previous => !previous)}
                        >
                            {t("founder.whyEvidence")}
                            {topic.conflicts.length || topic.unknowns.length ? (
                                <Badge variant="warn" className={s.label}>
                                    {t("founder.cautionCount", {
                                        conflicts: topic.conflicts.length,
                                        unknowns: topic.unknowns.length,
                                    })}
                                </Badge>
                            ) : null}
                            <ChevronDown
                                aria-hidden="true"
                                className={cn(
                                    "size-4 transition-transform motion-reduce:transition-none",
                                    evidenceOpen && "rotate-180"
                                )}
                            />
                        </Button>
                    </div>
                    <Collapsible open={evidenceOpen}>
                        <CollapsibleContent id={id + "-evidence"} className={s.accordionContent}>
                            <div className="space-y-4">
                                {recommendation ? (
                                    <>
                                        <section>
                                            <h3 className={s.label}>{t("founder.because")}</h3>
                                            <p className={s.prose}>{recommendation.because}</p>
                                        </section>
                                        <section>
                                            <h3 className={s.label}>
                                                {t("founder.wouldChangeIf")}
                                            </h3>
                                            <p className={s.prose}>
                                                {recommendation.wouldChangeIf}
                                            </p>
                                        </section>
                                    </>
                                ) : null}
                                {(
                                    [
                                        ["facts", topic.facts],
                                        ["conflicts", topic.conflicts],
                                    ] as const
                                ).map(([label, items]) =>
                                    items.length ? (
                                        <section key={label} className="space-y-2">
                                            <h3 className={s.label}>{t(`founder.${label}`)}</h3>
                                            <ul className="space-y-3">
                                                {items.map((fact, index) => (
                                                    <li key={index} className="space-y-2">
                                                        <p className={s.prose}>{fact.text}</p>
                                                        <ReviewCitationChips
                                                            refs={fact.refs}
                                                            sources={sources}
                                                            documents={documents}
                                                            onInspect={onInspect}
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    ) : null
                                )}
                                {(
                                    [
                                        ["whyItMatters", topic.whyItMatters],
                                        ["whyNow", topic.whyNow],
                                        ["rationale", topic.rationale],
                                        ["help", topic.helpRequested],
                                    ] as const
                                ).map(([label, value]) =>
                                    value ? (
                                        <section key={label}>
                                            <h3 className={s.label}>{t(`founder.${label}`)}</h3>
                                            <p className={s.prose}>{value}</p>
                                        </section>
                                    ) : null
                                )}
                                {topic.unknowns.length ? (
                                    <section>
                                        <h3 className={s.label}>{t("founder.unknowns")}</h3>
                                        <ul className="list-inside list-disc space-y-1">
                                            {topic.unknowns.map((unknown, index) => (
                                                <li key={index}>{unknown}</li>
                                            ))}
                                        </ul>
                                    </section>
                                ) : null}
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                    {versions.length > 1 ? (
                        <Collapsible>
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    {t("founder.previousDecisions")}
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className={s.accordionContent}>
                                <div className="space-y-3 pt-3">
                                    {versions.slice(1).map(decision => (
                                        <div key={decision.version}>
                                            <p className="whitespace-pre-wrap">
                                                {decision.decision}
                                            </p>
                                            <p className={s.label}>
                                                {t("founder.decisionVersion", {
                                                    version: decision.version,
                                                    date: fmt.dateTime(decision.recordedAt),
                                                })}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    ) : null}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
