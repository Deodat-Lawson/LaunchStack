"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { addDays, parseIsoDate, weekStartOf } from "@launchstack/pipelines/vantage/week";
import { ChevronDown, ChevronLeft, ChevronRight, FlaskConical, History } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import { toolTabHref } from "~/lib/tool-app/locations";
import { cn } from "~/lib/utils";
import { useWeeklyReviewData } from "../_lib/useWeeklyReviewData";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";
import { useVantageFormat } from "../_lib/format";
import { WeeklyReviewTopicCard } from "../_components/WeeklyReviewTopicCard";
import { ReviewCitationDialog } from "../_components/ReviewCitationDialog";
import { ReviewCitationChips, reviewSources } from "../_components/ReviewCitationChips";
import { ReviewGenerationProgress } from "../_components/ReviewGenerationProgress";
import { ReportSources } from "../_components/ReportSources";
import s from "../_components/review-layout.module.css";

type Draft = { text: string };
const normalizedWeek = (value?: string | null) => weekStartOf(parseIsoDate(value) ?? new Date());
export function ThisWeekScreen({ week: initialWeek }: { week?: string | null }) {
    const t = useTranslations("vantage.weeklyReview");
    const fmt = useVantageFormat();
    const errorText = useWeeklyReviewErrorText();
    const nav = useOptionalToolNav();
    const [week, setWeek] = useState(() => normalizedWeek(initialWeek));
    useEffect(() => {
        setWeek(normalizedWeek(initialWeek));
    }, [initialWeek]);
    const data = useWeeklyReviewData(week);
    const { review, context, generation } = data;
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [expanded, setExpanded] = useState<Record<string, string | null>>({});
    const [citation, setCitation] = useState<{ reportId: string; ref: string } | null>(null);
    const pending = useRef(new Set<string>());
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const sources = review ? reviewSources(review) : [];
    const decidedIds = new Set(review?.decisions.map(decision => decision.topicId));
    const firstUndecided =
        review?.report.topics.find(topic => !decidedIds.has(topic.id))?.id ?? null;
    const openTopic =
        review && Object.prototype.hasOwnProperty.call(expanded, review.id)
            ? expanded[review.id]
            : firstUndecided;
    const needsSetup = context?.canConfigure === true && !context.policy?.architecture_document_id;
    const canGenerate =
        data.enabled === true &&
        data.ready &&
        !generation.running &&
        !needsSetup &&
        data.roleContext?.canEdit !== false;
    const inspect = (ref: string) => {
        if (review) setCitation({ reportId: review.id, ref });
    };
    const contextHref = "/context?week=" + encodeURIComponent(week);
    const contextLink = nav ? (
        <ToolLink href={contextHref}>{t("openContext")}</ToolLink>
    ) : (
        <a href={toolTabHref("vantage", contextHref)}>{t("openContext")}</a>
    );
    async function record(topicId: string) {
        if (!review) return;
        const topic = review.report.topics.find(item => item.id === topicId);
        if (!topic) return;
        const key = `${review.id}:${topicId}`;
        const submitted = drafts[key];
        const text = submitted === undefined ? (topic.recommendation?.call ?? "") : submitted.text;
        if (!text.trim() || pending.current.has(key)) return;
        pending.current.add(key);
        setSaving(previous => ({ ...previous, [key]: true }));
        setErrors(previous => ({ ...previous, [key]: "" }));
        try {
            // Keep the visible text verbatim; only an explicit click calls this endpoint.
            const current = await data.recordDecision(topicId, text);
            if (current && mounted.current) {
                setDrafts(previous => {
                    if (previous[key] !== submitted) return previous;
                    const next = { ...previous };
                    delete next[key];
                    return next;
                });
                const index = review.report.topics.findIndex(item => item.id === topicId);
                const next = [
                    ...review.report.topics.slice(index + 1),
                    ...review.report.topics.slice(0, index),
                ].find(item => !decidedIds.has(item.id));
                setExpanded(previous => ({ ...previous, [review.id]: next?.id ?? null }));
            }
        } catch (error) {
            if (mounted.current) setErrors(previous => ({ ...previous, [key]: errorText(error) }));
        } finally {
            pending.current.delete(key);
            if (mounted.current) setSaving(previous => ({ ...previous, [key]: false }));
        }
    }
    return (
        <div className={s.surface} data-review-surface>
            <div className={cn(s.column, "space-y-5")}>
                {data.enabled === false && !review && data.runs.length === 0 ? (
                    <EmptyState
                        title={t("founder.disabledTitle")}
                        body={t("founder.disabledBody")}
                    />
                ) : (
                    <>
                        <div className={s.toolbar} data-testid="review-toolbar">
                            <div className={s.weekPicker}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("founder.previousWeek")}
                                    onClick={() => setWeek(previous => addDays(previous, -7))}
                                >
                                    <ChevronLeft aria-hidden="true" />
                                </Button>
                                <span className={s.weekLabel} aria-live="polite">
                                    {t("founder.weekOf", { date: fmt.date(week) })}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("founder.nextWeek")}
                                    onClick={() => setWeek(previous => addDays(previous, 7))}
                                >
                                    <ChevronRight aria-hidden="true" />
                                </Button>
                            </div>
                            {review?.evidence.qualityEvidence === "injected-deterministic" ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge
                                            className={cn(s.injectedBadge, s.label)}
                                            variant="warn"
                                            tabIndex={0}
                                            aria-label={t("synthetic")}
                                        >
                                            <FlaskConical aria-hidden="true" className="size-3.5" />
                                            <span className={s.injectedText}>
                                                {t("founder.injectedBadge")}
                                            </span>
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("synthetic")}</TooltipContent>
                                </Tooltip>
                            ) : null}
                            <Select
                                value={review?.id ?? undefined}
                                disabled={!data.ready || generation.running}
                                onValueChange={id => void data.selectReport(id)}
                            >
                                <SelectTrigger
                                    aria-label={t("history")}
                                    className={s.historyTrigger}
                                >
                                    <History aria-hidden="true" className="size-4" />
                                    <span className={s.historyVersion}>
                                        {review
                                            ? t("founder.versionShort", { version: review.version })
                                            : t("history")}
                                    </span>
                                    <SelectValue
                                        className="sr-only"
                                        placeholder={t("selectReport")}
                                    />
                                </SelectTrigger>
                                <SelectContent className={s.typography}>
                                    {data.runs
                                        .filter(run => run.status === "accepted")
                                        .map(run => (
                                            <SelectItem key={run.id} value={run.id}>
                                                {t("founder.reportVersion", {
                                                    version: run.review_version,
                                                    date: fmt.dateTime(run.created_at),
                                                })}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                            <Button
                                variant={review ? "outline" : "default"}
                                disabled={!canGenerate}
                                onClick={() => void data.generate()}
                            >
                                {t(review ? "founder.regenerate" : "generate")}
                            </Button>
                        </div>
                        <ReviewGenerationProgress generation={generation} />
                        {data.loadError ? (
                            <InlineError
                                message={errorText(data.loadError)}
                                onRetry={() => void data.reload()}
                            />
                        ) : null}
                        {data.contextError ? (
                            <InlineError
                                message={errorText(data.contextError)}
                                onRetry={() => void data.reloadContext()}
                            />
                        ) : null}
                        {generation.error ? (
                            <InlineError message={errorText(generation.error)} />
                        ) : null}
                        {data.loading && !review ? (
                            <div aria-busy="true" className="space-y-4">
                                <Skeleton className="h-36 w-full" />
                                <Skeleton className="h-52 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        ) : null}
                        {!data.loading && data.ready && !review && !data.loadError ? (
                            <Card className={s.brief}>
                                <header className="mb-5 space-y-2">
                                    <h1 className={s.title}>{t("founder.title")}</h1>
                                    <p className={s.label}>{t("founder.description")}</p>
                                </header>
                                {needsSetup ? (
                                    <EmptyState
                                        title={t("founder.setupTitle")}
                                        body={t("founder.setupBody")}
                                        action={
                                            <Button asChild variant="outline">
                                                {contextLink}
                                            </Button>
                                        }
                                    />
                                ) : !data.contextLoading ? (
                                    <EmptyState
                                        title={t("founder.emptyTitle")}
                                        body={t("founder.emptyBody")}
                                        action={
                                            <Button
                                                disabled={!canGenerate}
                                                onClick={() => void data.generate()}
                                            >
                                                {t("generate")}
                                            </Button>
                                        }
                                    />
                                ) : null}
                            </Card>
                        ) : null}
                        {review ? (
                            <>
                                <Card className={s.brief}>
                                    <p className={s.label}>{t("founder.briefLabel")}</p>
                                    <h1 className={cn(s.title, s.prose)}>
                                        {review.report.headline}
                                    </h1>
                                    <p className={s.prose}>{review.report.brief}</p>
                                    <Collapsible>
                                        <CollapsibleTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-auto gap-2 p-0"
                                            >
                                                {t("founder.readSummary")}
                                                <ChevronDown
                                                    aria-hidden="true"
                                                    className="size-4"
                                                />
                                            </Button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className={s.accordionContent}>
                                            <p className={cn(s.prose, "whitespace-pre-wrap pt-3")}>
                                                {review.report.summary}
                                            </p>
                                        </CollapsibleContent>
                                    </Collapsible>
                                    {review.report.keyFigures.length ? (
                                        <div className={s.stats}>
                                            {review.report.keyFigures.map((figure, index) => (
                                                <div
                                                    key={index}
                                                    className={cn(s.stat, "space-y-2")}
                                                >
                                                    <p className={s.label}>{figure.label}</p>
                                                    <p className={s.title}>{figure.value}</p>
                                                    {figure.derivation ? (
                                                        <p className={s.label}>
                                                            {t(
                                                                `founder.derivation.${figure.derivation.op}`
                                                            )}
                                                            :{" "}
                                                            {fmt.list(
                                                                figure.derivation.inputs.map(
                                                                    input => fmt.number(input.value)
                                                                )
                                                            )}
                                                        </p>
                                                    ) : null}
                                                    <ReviewCitationChips
                                                        refs={figure.refs}
                                                        sources={sources}
                                                        documents={context?.documents}
                                                        onInspect={inspect}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </Card>
                                <section
                                    className="space-y-2"
                                    aria-label={t("founder.decisionCount", {
                                        decided: review.report.topics.filter(topic =>
                                            decidedIds.has(topic.id)
                                        ).length,
                                        total: review.report.topics.length,
                                    })}
                                >
                                    <p className={s.label}>
                                        {t("founder.decisionCount", {
                                            decided: review.report.topics.filter(topic =>
                                                decidedIds.has(topic.id)
                                            ).length,
                                            total: review.report.topics.length,
                                        })}
                                    </p>
                                    <div className={s.segments}>
                                        {review.report.topics.map((topic, index) => (
                                            <span
                                                key={topic.id}
                                                className={s.segment}
                                                data-decided={decidedIds.has(topic.id)}
                                                role="img"
                                                aria-label={t("founder.progressSegment", {
                                                    number: index + 1,
                                                    status: t(
                                                        decidedIds.has(topic.id)
                                                            ? "founder.decided"
                                                            : "founder.needsDecision"
                                                    ),
                                                })}
                                            />
                                        ))}
                                    </div>
                                </section>
                                <div className="space-y-3">
                                    {review.report.topics.map((topic, index) => {
                                        const key = `${review.id}:${topic.id}`;
                                        return (
                                            <WeeklyReviewTopicCard
                                                key={key}
                                                topic={topic}
                                                number={index + 1}
                                                open={openTopic === topic.id}
                                                onOpenChange={open =>
                                                    setExpanded(previous => ({
                                                        ...previous,
                                                        [review.id]: open ? topic.id : null,
                                                    }))
                                                }
                                                decisions={review.decisions}
                                                draft={drafts[key]?.text}
                                                onDraft={text =>
                                                    setDrafts(previous => ({
                                                        ...previous,
                                                        [key]: { text },
                                                    }))
                                                }
                                                onReset={() =>
                                                    setDrafts(previous => {
                                                        const next = { ...previous };
                                                        delete next[key];
                                                        return next;
                                                    })
                                                }
                                                onRecord={() => void record(topic.id)}
                                                saving={saving[key] ?? false}
                                                disabled={
                                                    !data.ready ||
                                                    generation.running ||
                                                    data.roleContext?.canEdit === false
                                                }
                                                error={errors[key]}
                                                sources={sources}
                                                documents={context?.documents}
                                                onInspect={inspect}
                                            />
                                        );
                                    })}
                                </div>
                                <ReportSources
                                    review={review}
                                    context={context}
                                    onInspect={inspect}
                                />
                                <ReviewCitationDialog
                                    reportId={review.id}
                                    reference={
                                        citation?.reportId === review.id ? citation.ref : null
                                    }
                                    onClose={() => setCitation(null)}
                                />
                            </>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
