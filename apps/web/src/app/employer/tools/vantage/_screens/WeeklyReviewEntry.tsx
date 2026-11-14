"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { AgendaScreen } from "./AgendaScreen";
import type { WeeklyReviewV21 } from "@launchstack/pipelines/vantage/weekly-review-v21";

type ScopedSourceCoverage = {
    documentId: string;
    parentVersion: string;
    scopeHash: string;
    coverage: {
        state: "full_document_reviewed" | "relevant_spans_reviewed" | "insufficient_evidence";
        qualification: string;
        includedUnits: number;
        requiredUnits: number;
        originalCompleteness: "verified_complete" | "unknown";
    };
};
type Saved = {
    id: string;
    version: number;
    report: Omit<WeeklyReviewV21, "topics"> & {
        topics: (WeeklyReviewV21["topics"][number] & { id: string })[];
    };
    decisions: { topicId: string; decision: string; version: number }[];
    evidence: {
        qualityEvidence?: string;
        inputSnapshot?: { scopedEvidence?: ScopedSourceCoverage[] };
    };
};
type RunSummary = { id: string; status: string; week_start: string; created_at: string };
type RunList = { enabled: boolean; activeId: string | null; runs: RunSummary[] };
type Context = {
    documents?: { id: string; title: string }[];
    canConfigure: boolean;
    policy?: {
        version: number;
        architecture_document_id: string | number;
        required_document_ids: (string | number)[];
    } | null;
    preferences?: { version: number; star_document_ids: (string | number)[] } | null;
};
async function call<T = unknown>(
    path: string,
    body?: unknown,
    key?: string,
    method?: "PATCH"
): Promise<T> {
    const response = await fetch("/api/vantage/reviews" + path, {
        method: method ?? (body ? "POST" : "GET"),
        headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
        const code =
            typeof value === "object" &&
            value !== null &&
            "error" in value &&
            typeof value.error === "string"
                ? value.error
                : "review_unavailable";
        throw Error(code);
    }
    return value as T;
}
function thisWeek() {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    return now.toISOString().slice(0, 10);
}
export function WeeklyReviewEntry({ week: initialWeek }: { week?: string | null }) {
    const t = useTranslations("vantage.weeklyReview");
    const errorText = (code: string) => {
        switch (code) {
            case "required_context_incomplete":
                return t("required_context_incomplete");
            case "source_access_denied":
                return t("source_access_denied");
            case "candidate_not_admitted":
                return t("candidate_not_admitted");
            case "stale_review":
                return t("stale_review");
            default:
                return t("requestFailed");
        }
    };
    const [enabled, setEnabled] = useState<boolean | null>(null),
        [error, setError] = useState("");
    const [week, setWeek] = useState(initialWeek ?? thisWeek()),
        [runs, setRuns] = useState<RunSummary[]>([]);
    const [review, setReview] = useState<Saved | null>(null),
        [busy, setBusy] = useState(false);
    const [policyVersion, setPolicyVersion] = useState(0),
        [architecture, setArchitecture] = useState(""),
        [required, setRequired] = useState(""),
        [admin, setAdmin] = useState(false);
    const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]),
        [stars, setStars] = useState<string[]>([]),
        [preferenceVersion, setPreferenceVersion] = useState(0);
    const [decisions, setDecisions] = useState<Record<string, { text: string }>>({});
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [contextReady, setContextReady] = useState(false);
    const request = useRef(0);
    const operation = useRef(0);
    const invalidate = useCallback(() => {
        request.current++;
        operation.current++;
    }, []);
    const load = useCallback(
        async (id?: string, refreshContext = true) => {
            const identity = ++request.current;
            const current = () => identity === request.current;
            setLoading(true);
            setLoadedWeek(null);
            if (refreshContext) setContextReady(false);
            setError("");
            setReview(null);
            try {
                const data = await call<RunList>("?weekStart=" + encodeURIComponent(week));
                if (!current()) return;
                setEnabled(data.enabled);
                const weekRuns = data.runs.filter(
                    run => String(run.week_start).slice(0, 10) === week
                );
                setRuns(weekRuns);
                setActiveId(data.activeId);
                setLoadedWeek(week);
                const chosen =
                    id ?? data.activeId ?? weekRuns.find(run => run.status === "accepted")?.id;
                // Report access and configuration access are independent. A revoked historical
                // dependency must still allow replacement using the actual active pointer.
                const results = await Promise.allSettled([
                    (async () => {
                        const saved = chosen ? await call<Saved>("/" + chosen) : null;
                        if (current()) setReview(saved);
                    })(),
                    (async () => {
                        if (!data.enabled || !refreshContext) return;
                        const context = await call<Context>("/context");
                        if (!current()) return;
                        setDocuments(context.documents ?? []);
                        setStars((context.preferences?.star_document_ids ?? []).map(String));
                        setPreferenceVersion(context.preferences?.version ?? 0);
                        setAdmin(context.canConfigure);
                        setPolicyVersion(context.policy?.version ?? 0);
                        setArchitecture(String(context.policy?.architecture_document_id ?? ""));
                        setRequired((context.policy?.required_document_ids ?? []).join(","));
                        setContextReady(true);
                    })(),
                ]);
                if (!current()) return;
                const failure = results.find(result => result.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
            } catch (reason) {
                if (current()) setError(reason instanceof Error ? reason.message : "requestFailed");
            } finally {
                if (current()) setLoading(false);
            }
        },
        [week]
    );
    useEffect(() => {
        void load();
        return invalidate;
    }, [load, invalidate]);
    async function act(work: (current: () => boolean) => Promise<void>) {
        const identity = ++operation.current;
        const requestIdentity = request.current;
        const current = () => identity === operation.current && requestIdentity === request.current;
        setBusy(true);
        setError("");
        try {
            await work(current);
        } catch (e) {
            if (current()) setError(e instanceof Error ? e.message : "requestFailed");
        } finally {
            if (identity === operation.current) setBusy(false);
        }
    }
    const ready = !loading && loadedWeek === week;
    if (enabled === false) return <AgendaScreen week={initialWeek ?? null} />;
    return (
        <div className="mx-auto max-w-[1100px] space-y-5 p-6">
            <h1 className="text-xl font-semibold">{t("title")}</h1>
            <p className="text-ink-2 text-sm">{t("description")}</p>
            {error && (
                <p role="alert" className="text-danger">
                    {errorText(error)}
                </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <Label htmlFor="weekly-review-week">{t("week")}</Label>
                    <Input
                        id="weekly-review-week"
                        type="date"
                        value={week}
                        onChange={e => {
                            invalidate();
                            setBusy(false);
                            setLoading(true);
                            setReview(null);
                            setWeek(e.target.value);
                        }}
                    />
                </div>
                <Button
                    disabled={busy || !ready || enabled !== true}
                    onClick={() =>
                        act(async current => {
                            const saved = await call<Saved>(
                                "",
                                { weekStart: week, expectedActiveId: activeId },
                                crypto.randomUUID()
                            );
                            if (current()) await load(saved.id, false);
                        })
                    }
                >
                    {t("generate")}
                </Button>
                <div>
                    <Label htmlFor="weekly-review-history">{t("history")}</Label>
                    <Select
                        disabled={busy || !ready}
                        value={review?.id ?? undefined}
                        onValueChange={value => act(() => load(value, false))}
                    >
                        <SelectTrigger id="weekly-review-history">
                            <SelectValue placeholder={t("selectReport")} />
                        </SelectTrigger>
                        <SelectContent>
                            {runs
                                .filter(run => run.status === "accepted")
                                .map(run => (
                                    <SelectItem key={run.id} value={run.id}>
                                        {String(run.week_start).slice(0, 10)} ?{" "}
                                        {new Date(run.created_at).toLocaleString()}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            {ready && contextReady && admin && (
                <details className="border-line rounded border p-4">
                    <summary>{t("requiredContext")}</summary>
                    <p className="text-ink-2 my-2 text-sm">{t("contextHelp")}</p>
                    <Label htmlFor="weekly-review-architecture">{t("architecture")}</Label>
                    <Select value={architecture || undefined} onValueChange={setArchitecture}>
                        <SelectTrigger id="weekly-review-architecture">
                            <SelectValue placeholder={t("selectDocument")} />
                        </SelectTrigger>
                        <SelectContent>
                            {documents.map(doc => (
                                <SelectItem key={doc.id} value={doc.id}>
                                    {doc.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Label htmlFor="weekly-review-required">{t("requiredDocuments")}</Label>
                    <div className="max-h-48 space-y-2 overflow-auto">
                        {documents
                            .filter(doc => doc.id !== architecture)
                            .map(doc => (
                                <Label key={doc.id} className="flex items-center gap-2">
                                    <Checkbox
                                        checked={required.split(",").includes(doc.id)}
                                        onCheckedChange={checked => {
                                            const ids = required.split(",").filter(Boolean);
                                            setRequired(
                                                (checked
                                                    ? [...ids, doc.id]
                                                    : ids.filter(id => id !== doc.id)
                                                ).join(",")
                                            );
                                        }}
                                    />
                                    {doc.title}
                                </Label>
                            ))}
                    </div>
                    <Button
                        className="mt-3"
                        disabled={busy || !architecture}
                        onClick={() =>
                            act(async current => {
                                await call("/context", {
                                    expectedVersion: policyVersion,
                                    architectureDocumentId: architecture,
                                    requiredDocumentIds: required
                                        .split(",")
                                        .map(s => s.trim())
                                        .filter(Boolean),
                                });
                                if (current()) await load(review?.id);
                            })
                        }
                    >
                        {t("saveContext")}
                    </Button>
                </details>
            )}
            {enabled && ready && contextReady && (
                <details className="border-line rounded border p-4">
                    <summary>{t("personalStars")}</summary>
                    <p className="text-ink-2 my-2 text-sm">{t("starHelp")}</p>
                    <div className="max-h-48 space-y-2 overflow-auto">
                        {documents.map(doc => (
                            <Label key={doc.id} className="flex items-center gap-2">
                                <Checkbox
                                    checked={stars.includes(doc.id)}
                                    onCheckedChange={checked =>
                                        setStars(
                                            checked
                                                ? [...stars, doc.id]
                                                : stars.filter(id => id !== doc.id)
                                        )
                                    }
                                />
                                {doc.title}
                            </Label>
                        ))}
                    </div>
                    <Button
                        className="mt-3"
                        disabled={busy || stars.length > 8}
                        onClick={() =>
                            act(async current => {
                                await call(
                                    "/context",
                                    { expectedVersion: preferenceVersion, starDocumentIds: stars },
                                    undefined,
                                    "PATCH"
                                );
                                if (current()) await load(review?.id);
                            })
                        }
                    >
                        {t("saveStars")}
                    </Button>
                </details>
            )}
            {review && (
                <article className="space-y-5">
                    {review.evidence?.qualityEvidence === "injected-deterministic" && (
                        <p className="text-ink-2 text-sm">{t("synthetic")}</p>
                    )}
                    {review.evidence?.inputSnapshot?.scopedEvidence?.length ? (
                        <section
                            aria-label={t("sourceCoverage")}
                            className="border-line space-y-3 rounded border p-4"
                        >
                            <h2 className="font-semibold">{t("sourceCoverage")}</h2>
                            {review.evidence.inputSnapshot.scopedEvidence.map(source => (
                                <div
                                    key={source.documentId + ":" + source.scopeHash}
                                    className="space-y-1 text-sm"
                                >
                                    <p>
                                        {t("coverageSource", {
                                            document: source.documentId,
                                            version: source.parentVersion,
                                        })}
                                    </p>
                                    <p>{t(source.coverage.state)}</p>
                                    <p>{source.coverage.qualification}</p>
                                    <p>
                                        {t("coverageUnits", {
                                            included: source.coverage.includedUnits,
                                            required: source.coverage.requiredUnits,
                                        })}
                                    </p>
                                    {source.coverage.state === "relevant_spans_reviewed" && (
                                        <p>{t("configuredSpansOnly")}</p>
                                    )}
                                    {source.coverage.originalCompleteness === "unknown" && (
                                        <p>{t("originalCompletenessUnknown")}</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    ) : null}
                    <header>
                        <h2 className="text-lg font-semibold">{review.report.headline}</h2>
                        <p>{review.report.brief}</p>
                    </header>
                    <p>{review.report.summary}</p>
                    <div className="flex flex-wrap gap-4">
                        {review.report.keyFigures.map((figure, i) => (
                            <div key={i} className="border-line rounded border p-3">
                                <strong>
                                    {figure.label}: {figure.value}
                                </strong>
                                <p className="text-ink-2 text-xs">{figure.refs.join(", ")}</p>
                                {figure.derivation && (
                                    <p className="text-xs">{JSON.stringify(figure.derivation)}</p>
                                )}
                            </div>
                        ))}
                    </div>
                    {review.report.topics.map(topic => {
                        const draftKey = JSON.stringify([review.id, topic.id]);
                        const draft = decisions[draftKey];
                        return (
                            <section
                                key={topic.id}
                                className="border-line space-y-3 rounded border p-4"
                            >
                                <h3 className="font-semibold">{topic.title}</h3>
                                {topic.facts.map((fact, i) => (
                                    <p key={i}>
                                        {fact.text}
                                        <span className="text-ink-2 block text-xs">
                                            {fact.refs.join(", ")}
                                        </span>
                                    </p>
                                ))}
                                {topic.conflicts.map((conflict, i) => (
                                    <p key={i}>
                                        {t("conflict")}: {conflict.text}
                                        <span className="text-ink-2 block text-xs">
                                            {conflict.refs.join(", ")}
                                        </span>
                                    </p>
                                ))}
                                <p>
                                    <strong>{t("why")}: </strong>
                                    {topic.whyItMatters}
                                </p>
                                <p>
                                    <strong>{t("whyNow")}: </strong>
                                    {topic.whyNow}
                                </p>
                                <p>{topic.decisionQuestion}</p>
                                <p>{topic.rationale}</p>
                                {topic.recommendation && (
                                    <div>
                                        <p>
                                            {topic.recommendation.call} (
                                            {topic.recommendation.confidence})
                                        </p>
                                        <p>{topic.recommendation.because}</p>
                                        <p>{topic.recommendation.wouldChangeIf}</p>
                                        <p className="text-ink-2 text-xs">
                                            {topic.recommendation.refs.join(", ")}
                                        </p>
                                    </div>
                                )}
                                <p>{topic.proposedNextStep}</p>
                                {topic.proposedOwner && (
                                    <p>
                                        {t("owner")}: {topic.proposedOwner}
                                    </p>
                                )}
                                {topic.proposedDue && (
                                    <p>
                                        {t("due")}: {topic.proposedDue}
                                    </p>
                                )}
                                {topic.helpRequested && (
                                    <p>
                                        {t("help")}: {topic.helpRequested}
                                    </p>
                                )}
                                {topic.unknowns.map((value, i) => (
                                    <p key={i}>
                                        {t("unknown")}: {value}
                                    </p>
                                ))}
                                {review.decisions
                                    .filter(d => d.topicId === topic.id)
                                    .map(d => (
                                        <p key={d.version} className="text-ink-2 text-sm">
                                            {t("recordedDecision")}: {d.decision}
                                        </p>
                                    ))}
                                <Label htmlFor={"decision-" + topic.id}>{t("decision")}</Label>
                                <Textarea
                                    id={"decision-" + topic.id}
                                    value={draft?.text ?? ""}
                                    onChange={e => {
                                        const text = e.target.value;
                                        setDecisions(previous => ({
                                            ...previous,
                                            [draftKey]: { text },
                                        }));
                                    }}
                                />
                                <Button
                                    disabled={busy || !ready || !draft?.text.trim()}
                                    onClick={() =>
                                        act(async current => {
                                            await call(
                                                "/" + review.id + "/decisions",
                                                {
                                                    expectedVersion: review.version,
                                                    topicId: topic.id,
                                                    decision: draft?.text,
                                                },
                                                crypto.randomUUID()
                                            );
                                            if (!current()) return;
                                            setDecisions(previous => {
                                                if (previous[draftKey] !== draft) return previous;
                                                const next = { ...previous };
                                                delete next[draftKey];
                                                return next;
                                            });
                                            await load(review.id, false);
                                        })
                                    }
                                >
                                    {t("saveDecision")}
                                </Button>
                            </section>
                        );
                    })}
                </article>
            )}
        </div>
    );
}
