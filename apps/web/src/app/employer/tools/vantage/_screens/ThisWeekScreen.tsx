"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { parseIsoDate, weekStartOf } from "@launchstack/pipelines/vantage/week";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import { toolTabHref } from "~/lib/tool-app/locations";
import { useWeeklyReviewData } from "../_lib/useWeeklyReviewData";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";
import { useVantageFormat } from "../_lib/format";
import { WeeklyReviewTopicCard } from "../_components/WeeklyReviewTopicCard";
import { ReviewCitationDialog } from "../_components/ReviewCitationDialog";
import { ReviewCitationChips, reviewSources } from "../_components/ReviewCitationChips";
import { ReviewGenerationProgress } from "../_components/ReviewGenerationProgress";
import { ReportSources } from "../_components/ReportSources";

type Draft = { text: string };
function normalizedWeek(value?: string | null) {
    return weekStartOf(parseIsoDate(value) ?? new Date());
}
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
    const [added, setAdded] = useState<Record<string, boolean>>({});
    const [citation, setCitation] = useState<{ reportId: string; ref: string } | null>(null);
    const reviewId = review?.id;
    const pending = useRef(new Set<string>());
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (!reviewId) return;
        try {
            const saved: unknown = JSON.parse(
                sessionStorage.getItem(`vantage-review-commitments:${reviewId}`) ?? "{}"
            );
            if (saved && typeof saved === "object")
                setAdded(previous => ({
                    ...previous,
                    ...Object.fromEntries(
                        Object.entries(saved)
                            .filter(([, value]) => value === true)
                            .map(([topicId]) => [`${reviewId}:${topicId}`, true])
                    ),
                }));
        } catch {
            // A session marker is optional; the commitment itself is stored by the server.
        }
    }, [reviewId]);
    const sources = review ? reviewSources(review) : [];
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
        const key = `${review.id}:${topicId}`;
        const submitted = drafts[key];
        if (!submitted?.text.trim() || pending.current.has(key)) return;
        pending.current.add(key);
        setSaving(previous => ({ ...previous, [key]: true }));
        setErrors(previous => ({ ...previous, [key]: "" }));
        try {
            const current = await data.recordDecision(topicId, submitted.text.trim());
            if (current && mounted.current)
                setDrafts(previous => {
                    if (previous[key] !== submitted) return previous;
                    const next = { ...previous };
                    delete next[key];
                    return next;
                });
        } catch (error) {
            if (mounted.current) setErrors(previous => ({ ...previous, [key]: errorText(error) }));
        } finally {
            pending.current.delete(key);
            if (mounted.current) setSaving(previous => ({ ...previous, [key]: false }));
        }
    }
    if (data.enabled === false)
        return (
            <div className="mx-auto max-w-5xl p-6">
                <EmptyState title={t("founder.disabledTitle")} body={t("founder.disabledBody")} />
            </div>
        );
    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold">{t("founder.title")}</h1>
                <p className="text-ink-2 text-sm">{t("founder.description")}</p>
            </header>
            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                    <Label htmlFor="this-week-date">{t("week")}</Label>
                    <Input
                        id="this-week-date"
                        type="date"
                        value={week}
                        onChange={event => {
                            const date = parseIsoDate(event.target.value);
                            if (date) setWeek(weekStartOf(date));
                        }}
                    />
                </div>
                <Button disabled={!canGenerate} onClick={() => void data.generate()}>
                    {t("generate")}
                </Button>
                <div className="min-w-48 space-y-1">
                    <Label htmlFor="this-week-history">{t("history")}</Label>
                    <Select
                        value={review?.id ?? undefined}
                        disabled={!data.ready || generation.running}
                        onValueChange={id => void data.selectReport(id)}
                    >
                        <SelectTrigger id="this-week-history" aria-label={t("history")}>
                            <SelectValue placeholder={t("selectReport")} />
                        </SelectTrigger>
                        <SelectContent>
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
                </div>
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
            {generation.error ? <InlineError message={errorText(generation.error)} /> : null}
            {data.loading && !review ? (
                <div aria-busy="true" className="space-y-4">
                    <Skeleton className="h-12 w-3/4" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-72 w-full" />
                </div>
            ) : null}
            {!data.loading && data.ready && !review && !data.loadError ? (
                needsSetup ? (
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
                            <Button disabled={!canGenerate} onClick={() => void data.generate()}>
                                {t("generate")}
                            </Button>
                        }
                    />
                ) : null
            ) : null}
            {review ? (
                <>
                    <header className="space-y-3">
                        {review.evidence.qualityEvidence === "injected-deterministic" ? (
                            <Badge
                                variant="warn"
                                className="max-w-full whitespace-normal text-left leading-relaxed"
                            >
                                {t("synthetic")}
                            </Badge>
                        ) : null}
                        <h2 className="text-2xl font-semibold sm:text-3xl">
                            {review.report.headline}
                        </h2>
                        <p className="text-lg">{review.report.brief}</p>
                        <p className="text-ink-2 whitespace-pre-wrap text-sm">
                            {review.report.summary}
                        </p>
                    </header>
                    {review.report.keyFigures.length ? (
                        <div className="grid gap-3 sm:grid-cols-3">
                            {review.report.keyFigures.map((figure, index) => (
                                <Card key={index}>
                                    <CardContent className="space-y-3 p-4">
                                        <p className="text-ink-2 text-sm">{figure.label}</p>
                                        <p className="text-2xl font-semibold">{figure.value}</p>
                                        {figure.derivation ? (
                                            <p className="text-ink-2 text-xs">
                                                {t(`founder.derivation.${figure.derivation.op}`)}:{" "}
                                                {fmt.list(
                                                    figure.derivation.inputs.map(input =>
                                                        fmt.number(input.value)
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
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : null}
                    <p className="text-ink-2 text-sm">
                        {t("founder.decisionCount", {
                            decided: review.report.topics.filter(topic =>
                                review.decisions.some(decision => decision.topicId === topic.id)
                            ).length,
                            total: review.report.topics.length,
                        })}
                    </p>
                    <div className="space-y-5">
                        {review.report.topics.map(topic => {
                            const key = `${review.id}:${topic.id}`;
                            return (
                                <WeeklyReviewTopicCard
                                    key={key}
                                    topic={topic}
                                    decisions={review.decisions}
                                    draft={drafts[key]?.text ?? ""}
                                    onDraft={text =>
                                        setDrafts(previous => ({ ...previous, [key]: { text } }))
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
                                    added={added[key] ?? false}
                                    onAdded={() => {
                                        setAdded(previous => ({ ...previous, [key]: true }));
                                        try {
                                            const saved: unknown = JSON.parse(
                                                sessionStorage.getItem(
                                                    `vantage-review-commitments:${review.id}`
                                                ) ?? "{}"
                                            );
                                            sessionStorage.setItem(
                                                `vantage-review-commitments:${review.id}`,
                                                JSON.stringify({
                                                    ...(saved && typeof saved === "object"
                                                        ? saved
                                                        : {}),
                                                    [topic.id]: true,
                                                })
                                            );
                                        } catch {
                                            // Storage restrictions do not undo a confirmed server-side commitment.
                                        }
                                    }}
                                />
                            );
                        })}
                    </div>
                    <ReportSources review={review} context={context} onInspect={inspect} />
                    <ReviewCitationDialog
                        reportId={review.id}
                        reference={citation?.reportId === review.id ? citation.ref : null}
                        onClose={() => setCitation(null)}
                    />
                </>
            ) : null}
        </div>
    );
}
