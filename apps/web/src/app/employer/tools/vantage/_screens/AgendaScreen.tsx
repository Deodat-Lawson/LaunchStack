"use client";

import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToolNav } from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import {
    vantageApi,
    vantageErrorMessage,
    VantageApiError,
    type AgendaV1Dto,
    type CommitmentDto,
    type MetricObservationDto,
    type TopicDto,
    type TopicV1Dto,
    type VantageEvidenceRef,
} from "../api";
import { TopicDialog, DecisionDialog } from "../_components/TopicDialogs";
import { SourceDialog, SourceLinks } from "../_components/SourceDialog";
import { BasisTag, FormError, StatusWord } from "../_components/Primitives";
import { vantagePath } from "../_lib/paths";
import {
    calendarAdd,
    formatReportingInstant,
    mondayOf,
    reportingDate,
    validReportingDate,
} from "../_lib/reporting";
import { weekRange } from "../_lib/format";

export function AgendaScreen({ week }: { week?: string | null }) {
    const normalized = week && validReportingDate(week) ? mondayOf(week) : (week ?? undefined);
    // A new selection owns fresh state, including dialogs and in-flight response guards.
    return <WeeklyAgenda key={normalized ?? "default"} week={normalized} />;
}

function WeeklyAgenda({ week }: { week?: string }) {
    const { navigate } = useToolNav();
    const invalid = Boolean(week && !validReportingDate(week));
    const res = useResource(invalid ? null : `vantage:v1:${week ?? "default"}`, async () => {
        try {
            return await vantageApi.agendas(week);
        } catch (e) {
            throw new Error(vantageErrorMessage(e));
        }
    });
    const [mode, setMode] = useState<"configured-model" | "rules">("configured-model");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editing, setEditing] = useState<TopicDto | "new" | null>(null);
    const [deciding, setDeciding] = useState<TopicDto | null>(null);
    const [source, setSource] = useState<VantageEvidenceRef | null>(null);
    const [filter, setFilter] = useState("all");
    const [stale, setStale] = useState(false);
    const running = useRef(false);
    const controller = useRef<AbortController | null>(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            controller.current?.abort();
        };
    }, []);
    const agenda = res.data?.agenda;
    const selected = res.data?.week ?? week;
    const future = Boolean(selected && selected > mondayOf(reportingDate()));
    const go = (date: string) => navigate(vantagePath(`/agenda?week=${date}`));
    const previous = useResource(
        selected && validReportingDate(selected) ? `vantage:previous:${selected}` : null,
        async () => {
            const previousWeek = calendarAdd(mondayOf(selected!), -7);
            const [period, actions, metricData] = await Promise.all([
                vantageApi.agendas(previousWeek),
                vantageApi.commitments(),
                vantageApi.metrics(),
            ]);
            return {
                period,
                actions: actions?.commitments ?? [],
                metricData: metricData ?? { definitions: [], observations: [] },
            };
        }
    );

    const reloadSaved = async () => {
        const refreshed = await vantageApi.agendas(selected);
        res.mutate(() => refreshed);
        setStale(false);
        setError(null);
        setNotice("Reloaded the saved report. Review the current version before editing.");
    };

    const reconcileTopic = (saved: TopicDto) => {
        res.mutate(current =>
            current.agenda
                ? {
                      ...current,
                      agenda: {
                          ...current.agenda,
                          topics: current.agenda.topics.map(topic =>
                              topic.id === saved.id ? { ...topic, ...saved } : topic
                          ),
                      },
                  }
                : current
        );
    };

    const refreshAfterWrite = async (savedTopic?: TopicDto) => {
        setStale(true);
        if (savedTopic) reconcileTopic(savedTopic);
        try {
            // useResource.reload intentionally keeps errors in hook state and
            // resolves; a write needs an explicit read so saved and refreshed
            // states cannot be conflated.
            const refreshed = await vantageApi.agendas(selected);
            res.mutate(() => refreshed);
            setStale(false);
            return true;
        } catch {
            setStale(true);
            setNotice("Saved, but refresh failed. Reload before making another change.");
            setError("Your change was saved, but the refreshed report could not be loaded.");
            return false;
        }
    };

    const run = async (label: string, work: () => Promise<unknown>) => {
        if (running.current) return;
        running.current = true;
        setBusy(label);
        setError(null);
        setNotice(null);
        try {
            await work();
        } catch (e) {
            if (alive.current) {
                const knownValidation =
                    e instanceof VantageApiError &&
                    e.status >= 400 &&
                    e.status < 500 &&
                    e.status !== 408 &&
                    e.status !== 409;
                if (!knownValidation) setStale(true);
                setError(vantageErrorMessage(e));
            }
        } finally {
            running.current = false;
            if (alive.current) setBusy(null);
        }
    };
    const generate = () =>
        run("Generating", async () => {
            const abort = new AbortController();
            controller.current = abort;
            const timeout = window.setTimeout(() => abort.abort(), 65_000);
            try {
                const { agenda: saved } = await vantageApi.prepare(selected, mode, abort.signal);
                if (!alive.current || abort.signal.aborted) return;
                res.mutate(current => ({ ...current, week: saved.weekStart, agenda: saved }));
                setNotice("Report generated and saved.");
                await refreshAfterWrite();
            } catch (e) {
                if (abort.signal.aborted && alive.current)
                    throw new VantageApiError(
                        "Generation could not be confirmed before the timeout. Reload the saved report before generating again.",
                        408,
                        {}
                    );
                throw e;
            } finally {
                window.clearTimeout(timeout);
            }
        });
    const patch = (topic: TopicV1Dto, status: "kept" | "dismissed") =>
        run("Saving topic", async () => {
            await vantageApi.patchTopic(topic.id, { status }, topic.contentVersion);
            const refreshed = await refreshAfterWrite();
            if (alive.current && refreshed)
                setNotice(
                    status === "kept"
                        ? "Topic kept on the agenda."
                        : "Topic dismissed and preserved."
                );
        });
    const topics = agenda?.topics.filter(t => filter === "all" || t.status === filter) ?? [];

    return (
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 pb-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-brand-ink mb-1 text-xs font-semibold uppercase tracking-widest">
                        Weekly decision agenda
                    </p>
                    <h1 className="display text-ink text-2xl">
                        {selected && validReportingDate(selected)
                            ? weekRange(selected, calendarAdd(selected, 6))
                            : "Your weekly review"}
                    </h1>
                    <p className="text-ink-2 mt-1 text-sm">
                        Review the evidence. Make the decision. Follow through.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label="Previous week"
                        disabled={!selected || invalid || !!busy}
                        onClick={() => selected && go(calendarAdd(selected, -7))}
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <div>
                        <label className="sr-only" htmlFor="agenda-week">
                            Reporting week
                        </label>
                        <Input
                            id="agenda-week"
                            type="date"
                            value={invalid ? "" : (selected ?? "")}
                            disabled={!!busy}
                            className="w-40"
                            onChange={e =>
                                validReportingDate(e.target.value) && go(mondayOf(e.target.value))
                            }
                        />
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label="Next week"
                        disabled={!selected || invalid || !!busy}
                        onClick={() => selected && go(calendarAdd(selected, 7))}
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => navigate(vantagePath("/agenda"))}
                    >
                        Default week
                    </Button>
                </div>
            </header>
            <section
                aria-label="Generation controls"
                className="bg-panel border-line flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
            >
                <div className="min-w-0">
                    <p className="text-ink text-sm font-medium">
                        {agenda
                            ? "Refresh the evidence, preserve your work"
                            : "Build this week’s agenda"}
                    </p>
                    <p className="text-ink-2 mt-1 max-w-[60ch] text-xs">
                        Edited topics, decisions and linked actions stay intact. New additions to
                        reviewed topics need your approval.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={mode}
                        onValueChange={value => setMode(value as typeof mode)}
                        disabled={!!busy}
                    >
                        <SelectTrigger className="w-44" aria-label="Generation mode">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="configured-model">Configured AI model</SelectItem>
                            <SelectItem value="rules">Rules only</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={() => void generate()}
                        disabled={!!busy || stale || res.loading || !res.data || future || invalid}
                    >
                        {busy === "Generating" ? (
                            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                            <Sparkles className="size-4" />
                        )}
                        {busy === "Generating"
                            ? "Generating…"
                            : agenda
                              ? "Regenerate report"
                              : "Generate report"}
                    </Button>
                </div>
                {future && (
                    <p className="text-warn w-full text-sm">
                        Future weeks can be viewed, but cannot be generated.
                    </p>
                )}
                {busy === "Generating" && (
                    <p role="status" className="text-ink-2 w-full text-sm">
                        Reading the selected period and saving the result. This can take up to a
                        minute.
                    </p>
                )}
            </section>
            {selected && validReportingDate(selected) && (
                <PreviousWeekContext
                    selectedWeek={selected}
                    currentAgenda={agenda ?? undefined}
                    data={previous.data ?? undefined}
                    loading={previous.loading}
                    error={previous.error}
                    onOpenObservation={setSource}
                />
            )}
            {(invalid || Boolean(res.error) || Boolean(error)) && (
                <div className="border-danger/30 bg-panel rounded-lg border p-4">
                    <FormError
                        message={invalid ? "Choose a valid reporting date." : (error ?? res.error)}
                    />
                    {!invalid && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            disabled={!!busy}
                            onClick={() =>
                                void run("Reloading", async () => {
                                    await reloadSaved();
                                })
                            }
                        >
                            <RefreshCw className="size-3.5" />
                            Reload saved report
                        </Button>
                    )}
                </div>
            )}
            {notice && (
                <p role="status" className="text-success text-sm">
                    {notice}
                </p>
            )}
            {res.loading ? (
                <SkeletonRows rows={3} height={100} />
            ) : agenda ? (
                <>
                    <ReportMetadata agenda={agenda} />
                    <section
                        className="border-line bg-panel rounded-xl border p-5"
                        aria-label="Report summary"
                    >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-ink font-semibold">The week at a glance</h2>
                            <span className="text-ink-3 text-xs">
                                {agenda.topics.length}{" "}
                                {agenda.topics.length === 1 ? "topic" : "topics"} ·{" "}
                                {agenda.topics.filter(t => t.decision).length}{" "}
                                {agenda.topics.filter(t => t.decision).length === 1
                                    ? "decision"
                                    : "decisions"}{" "}
                                · Saved version {agenda.version}
                            </span>
                        </div>
                        <p className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed">
                            {agenda.summary ?? "No summary was saved for this report."}
                        </p>
                        {agenda.execution?.outcome === "empty" && (
                            <p className="text-ink-2 mt-3 text-sm">
                                Generation completed with no eligible evidence. Add evidence or
                                write a topic to continue.
                            </p>
                        )}
                    </section>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div
                            className="flex flex-wrap gap-1"
                            role="group"
                            aria-label="Filter topics"
                        >
                            {["all", "suggested", "kept", "dismissed"].map(value => (
                                <Button
                                    key={value}
                                    size="sm"
                                    variant={filter === value ? "default" : "ghost"}
                                    aria-pressed={filter === value}
                                    onClick={() => setFilter(value)}
                                >
                                    {value === "all"
                                        ? "All topics"
                                        : value.charAt(0).toUpperCase() + value.slice(1)}
                                </Button>
                            ))}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!!busy || stale}
                            onClick={() => setEditing("new")}
                        >
                            Write a topic
                        </Button>
                    </div>
                    <div className="flex flex-col gap-4">
                        {topics.map((topic, index) => (
                            <article
                                key={topic.id}
                                className="border-line bg-panel overflow-hidden rounded-xl border"
                                aria-label={topic.title}
                            >
                                <div className="p-5">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span className="text-ink-3 font-mono text-xs">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <StatusWord
                                            tone={topic.status === "kept" ? "success" : "neutral"}
                                        >
                                            {topic.status}
                                        </StatusWord>
                                        <span className="text-ink-3 text-xs">
                                            {topic.origin === "ai"
                                                ? "AI suggestion"
                                                : topic.origin === "rules"
                                                  ? "Rules suggestion"
                                                  : "Human topic"}{" "}
                                            · Content version {topic.contentVersion}
                                        </span>
                                    </div>
                                    <h2 className="text-ink display text-lg">{topic.title}</h2>
                                    <div className="mt-4 grid gap-4">
                                        <div>
                                            <BasisTag basis="observed" />
                                            <ul className="mt-2 space-y-3">
                                                {topic.facts.map((fact, i) => (
                                                    <li key={i} className="text-ink text-sm">
                                                        <p className="whitespace-pre-wrap">
                                                            {fact.text}
                                                        </p>
                                                        {(fact.unsupported === true ||
                                                            !fact.refs.length) && (
                                                            <p className="text-warn mt-1 text-xs">
                                                                No verified supporting source on
                                                                file.
                                                            </p>
                                                        )}
                                                        <SourceLinks
                                                            refs={fact.refs}
                                                            onOpen={setSource}
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                            {!topic.facts.length && (
                                                <p className="text-ink-3 mt-2 text-sm">
                                                    No facts recorded.
                                                </p>
                                            )}
                                        </div>
                                        {topic.whyItMatters && (
                                            <div>
                                                <BasisTag basis="interpretation" />
                                                <p className="text-ink-2 mt-2 whitespace-pre-wrap text-sm">
                                                    {topic.whyItMatters}
                                                </p>
                                            </div>
                                        )}
                                        {topic.decisionQuestion && (
                                            <div className="bg-panel-2 rounded-lg p-3">
                                                <p className="text-ink-3 text-xs font-medium">
                                                    Decision to make
                                                </p>
                                                <p className="text-ink mt-1 text-sm font-medium">
                                                    {topic.decisionQuestion}
                                                </p>
                                            </div>
                                        )}
                                        {topic.proposedNextStep && (
                                            <div>
                                                <BasisTag basis="suggestion" />
                                                <p className="text-ink-2 mt-2 text-sm">
                                                    {topic.proposedNextStep}
                                                </p>
                                                <p className="text-ink-3 mt-1 text-xs">
                                                    Owner: {topic.proposedOwner ?? "Not proposed"} ·
                                                    Due: {topic.proposedDue ?? "Not proposed"}
                                                </p>
                                            </div>
                                        )}
                                        {topic.unknowns.length > 0 && (
                                            <div>
                                                <BasisTag basis="unknown" />
                                                <ul className="text-ink-2 mt-2 list-inside list-disc text-sm">
                                                    {topic.unknowns.map((item, i) => (
                                                        <li key={i}>{item}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {topic.conflicts.map((conflict, i) => (
                                            <div key={i}>
                                                <BasisTag basis="conflict" />
                                                <p className="text-ink-2 mt-2 text-sm">
                                                    {conflict.text}
                                                </p>
                                                <SourceLinks
                                                    refs={conflict.refs}
                                                    onOpen={setSource}
                                                />
                                            </div>
                                        ))}
                                        {topic.rationale && (
                                            <p className="text-ink-3 text-xs">
                                                Rationale: {topic.rationale}
                                            </p>
                                        )}
                                        {topic.helpRequested && (
                                            <p className="text-ink-2 text-sm">
                                                Help requested: {topic.helpRequested}
                                            </p>
                                        )}
                                        {topic.decision && (
                                            <div className="border-success/30 rounded-lg border p-3">
                                                <p className="text-success text-xs font-semibold">
                                                    Saved decision
                                                </p>
                                                <p className="text-ink mt-1 whitespace-pre-wrap text-sm">
                                                    {topic.decision}
                                                </p>
                                                {topic.decidedAt && (
                                                    <p className="text-ink-3 mt-1 text-xs">
                                                        {formatReportingInstant(topic.decidedAt)}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        {topic.commitmentId && (
                                            <Button
                                                variant="outline"
                                                className="w-fit"
                                                size="sm"
                                                onClick={() =>
                                                    navigate(
                                                        vantagePath(
                                                            `/commitments?action=${encodeURIComponent(topic.commitmentId!)}`
                                                        )
                                                    )
                                                }
                                            >
                                                View linked action
                                            </Button>
                                        )}
                                    </div>
                                    <div className="mt-5 flex flex-wrap gap-2">
                                        {topic.status !== "kept" && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={!!busy || stale}
                                                onClick={() => void patch(topic, "kept")}
                                            >
                                                {topic.status === "dismissed"
                                                    ? "Restore topic"
                                                    : "Keep topic"}
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={!!busy || stale}
                                            onClick={() => setEditing(topic)}
                                        >
                                            Edit topic
                                        </Button>
                                        {topic.status !== "dismissed" && (
                                            <Button
                                                size="sm"
                                                disabled={!!busy || stale}
                                                onClick={() => setDeciding(topic)}
                                            >
                                                {topic.decision
                                                    ? "Edit decision"
                                                    : "Record decision"}
                                            </Button>
                                        )}
                                        {topic.status !== "dismissed" && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={!!busy || stale}
                                                onClick={() => void patch(topic, "dismissed")}
                                            >
                                                Dismiss topic
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                {agenda.enhancements
                                    .filter(e => e.topicId === topic.id)
                                    .map(enhancement => {
                                        const enhancementStale =
                                            enhancement.baseTopicVersion !== topic.contentVersion;
                                        return (
                                            <section
                                                key={enhancement.id}
                                                className="border-line bg-panel-2 border-t p-5"
                                                aria-label={`${enhancement.status === "accepted" ? "Approved addition" : "Suggested addition"}: ${enhancement.kind}`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <h3 className="text-ink text-sm font-semibold">
                                                        {enhancement.status === "accepted"
                                                            ? "Approved addition"
                                                            : enhancement.status === "dismissed"
                                                              ? "Dismissed addition"
                                                              : "Review suggested addition"}
                                                    </h3>
                                                    <span className="text-ink-3 text-xs">
                                                        {enhancement.kind}
                                                    </span>
                                                </div>
                                                <p className="text-ink mt-2 whitespace-pre-wrap text-sm">
                                                    {enhancement.text}
                                                </p>
                                                <p className="text-ink-2 mt-2 text-xs">
                                                    Why this was suggested: {enhancement.rationale}
                                                </p>
                                                <SourceLinks
                                                    refs={enhancement.refs}
                                                    onOpen={setSource}
                                                />
                                                {enhancement.status === "suggested" && (
                                                    <>
                                                        {enhancementStale && (
                                                            <p className="text-warn mt-3 text-xs">
                                                                The original topic has changed. This
                                                                addition needs regeneration before
                                                                it can be reviewed.
                                                            </p>
                                                        )}
                                                        <div className="mt-3 flex gap-2">
                                                            {(
                                                                ["accepted", "dismissed"] as const
                                                            ).map(status => (
                                                                <Button
                                                                    key={status}
                                                                    size="sm"
                                                                    variant={
                                                                        status === "accepted"
                                                                            ? "default"
                                                                            : "outline"
                                                                    }
                                                                    disabled={
                                                                        !!busy ||
                                                                        stale ||
                                                                        enhancementStale
                                                                    }
                                                                    onClick={() =>
                                                                        void run(
                                                                            "Reviewing addition",
                                                                            async () => {
                                                                                await vantageApi.reviewEnhancement(
                                                                                    topic.id,
                                                                                    enhancement.id,
                                                                                    status,
                                                                                    enhancement.baseTopicVersion
                                                                                );
                                                                                const refreshed =
                                                                                    await refreshAfterWrite();
                                                                                if (
                                                                                    alive.current &&
                                                                                    refreshed
                                                                                )
                                                                                    setNotice(
                                                                                        status ===
                                                                                            "accepted"
                                                                                            ? "Addition approved. Original topic preserved."
                                                                                            : "Addition dismissed."
                                                                                    );
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    {status === "accepted"
                                                                        ? "Accept addition"
                                                                        : "Dismiss addition"}
                                                                </Button>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </section>
                                        );
                                    })}
                            </article>
                        ))}
                        {topics.length === 0 && (
                            <p className="text-ink-3 border-line rounded-lg border border-dashed p-6 text-center text-sm">
                                {agenda.topics.length
                                    ? "No topics in this view."
                                    : "This saved report has no topics yet."}
                            </p>
                        )}
                    </div>
                    <TopicDialog
                        open={editing !== null}
                        onOpenChange={open => !open && setEditing(null)}
                        agendaId={agenda.id}
                        initial={editing === "new" ? null : editing}
                        onSaved={saved => {
                            void refreshAfterWrite(saved).then(refreshed => {
                                if (refreshed)
                                    setNotice(
                                        "Topic saved. Human edits are protected during regeneration."
                                    );
                            });
                        }}
                    />
                </>
            ) : res.data && !res.error ? (
                <section className="border-line rounded-xl border border-dashed px-6 py-12 text-center">
                    <h2 className="text-ink text-lg font-semibold">
                        No saved report for this week
                    </h2>
                    <p className="text-ink-2 mx-auto mt-2 max-w-md text-sm">
                        Choose a generation mode above when you are ready. Browsing weeks does not
                        generate or change a report.
                    </p>
                </section>
            ) : null}
            {res.data && res.data.agendas.length > 0 && (
                <section aria-label="Saved weeks">
                    <h2 className="text-ink mb-3 text-sm font-semibold">Saved weeks</h2>
                    <div className="flex flex-wrap gap-2">
                        {res.data.agendas.map(item => (
                            <Button
                                key={item.id}
                                variant="outline"
                                size="sm"
                                disabled={!!busy}
                                aria-current={item.weekStart === selected ? "date" : undefined}
                                onClick={() => go(item.weekStart)}
                            >
                                {weekRange(item.weekStart, item.weekEnd)} · {item.decidedCount}/
                                {item.topicCount} decided
                            </Button>
                        ))}
                    </div>
                </section>
            )}
            <DecisionDialog
                open={deciding !== null}
                onOpenChange={open => !open && setDeciding(null)}
                topic={deciding}
                onSaved={saved => {
                    void refreshAfterWrite(saved);
                    setNotice(
                        saved.commitmentId
                            ? "Decision saved. The linked action is available in Weekly Actions."
                            : "Decision saved."
                    );
                }}
            />
            <SourceDialog sourceRef={source} onClose={() => setSource(null)} />
        </div>
    );
}

type PreviousContextData = {
    period: { week: string; agenda: AgendaV1Dto | null };
    actions: CommitmentDto[];
    metricData: { definitions: unknown[]; observations: MetricObservationDto[] };
};

function PreviousWeekContext({
    selectedWeek,
    currentAgenda,
    data,
    loading,
    error,
    onOpenObservation,
}: {
    selectedWeek: string;
    currentAgenda: AgendaV1Dto | undefined;
    data: PreviousContextData | undefined;
    loading: boolean;
    error: string | null;
    onOpenObservation: (ref: VantageEvidenceRef) => void;
}) {
    const previousWeek = calendarAdd(mondayOf(selectedWeek), -7);
    const previousAgenda = data?.period.agenda;
    const openActions =
        data?.actions.filter(
            action =>
                action.status === "open" &&
                action.topicId !== null &&
                (action.agendaId === previousAgenda?.id ||
                    action.createdAt < `${selectedWeek}T00:00:00.000Z`)
        ) ?? [];
    const currentWeekEnd = calendarAdd(selectedWeek, 6);
    const previousWeekEnd = calendarAdd(previousWeek, 6);
    const observations = data?.metricData.observations ?? [];
    const comparisons =
        previousAgenda?.reportPeriod?.kind === "completed-week" &&
        currentAgenda?.reportPeriod?.kind === "completed-week"
            ? observations
                  .filter(
                      o =>
                          o.periodStart === previousWeek &&
                          o.periodEnd === previousWeekEnd &&
                          Boolean(o.source) &&
                          Number.isFinite(o.value) &&
                          o.createdAt <= previousAgenda.reportPeriod!.asOf
                  )
                  .map(prior => {
                      const priorCandidates = observations.filter(
                          o =>
                              o.metricId === prior.metricId &&
                              o.periodStart === previousWeek &&
                              o.periodEnd === previousWeekEnd &&
                              o.source === prior.source &&
                              Number.isFinite(o.value) &&
                              o.createdAt <= previousAgenda.reportPeriod!.asOf
                      );
                      const candidates = observations.filter(
                          o =>
                              o.metricId === prior.metricId &&
                              o.periodStart === selectedWeek &&
                              o.periodEnd === currentWeekEnd &&
                              o.source === prior.source &&
                              Number.isFinite(o.value) &&
                              o.createdAt <= currentAgenda.reportPeriod!.asOf
                      );
                      return priorCandidates.length === 1 && candidates.length === 1
                          ? { prior: priorCandidates[0]!, current: candidates[0]! }
                          : null;
                  })
                  .filter(
                      (x): x is { prior: MetricObservationDto; current: MetricObservationDto } =>
                          !!x
                  )
            : [];

    return (
        <section
            aria-label="Previous week context"
            className="border-line bg-panel-2 rounded-xl border px-4 py-3"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-ink text-sm font-semibold">Previous week context</h2>
                <ToolLink
                    className="text-brand-ink text-xs underline-offset-2 hover:underline"
                    href={`/agenda?week=${previousWeek}`}
                >
                    Open {weekRange(previousWeek, previousWeekEnd)}
                </ToolLink>
            </div>
            {loading ? (
                <p className="text-ink-3 mt-2 text-xs">Loading saved context…</p>
            ) : error ? (
                <p className="text-ink-3 mt-2 text-xs">Previous context is unavailable.</p>
            ) : !previousAgenda ? (
                <p className="text-ink-3 mt-2 text-xs">No saved report for the prior week.</p>
            ) : (
                <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                    <div>
                        <p className="text-ink-3 font-medium">Saved decisions</p>
                        {previousAgenda.topics.some(topic => topic.decision) ? (
                            <ul className="text-ink-2 mt-1 space-y-1">
                                {previousAgenda.topics
                                    .filter(topic => topic.decision)
                                    .map(topic => (
                                        <li key={topic.id}>
                                            <ToolLink
                                                className="underline-offset-2 hover:underline"
                                                href={`/agenda?week=${previousWeek}`}
                                            >
                                                {topic.title}: {topic.decision}
                                            </ToolLink>
                                        </li>
                                    ))}
                            </ul>
                        ) : (
                            <p className="text-ink-3 mt-1">None recorded.</p>
                        )}
                    </div>
                    <div>
                        <p className="text-ink-3 font-medium">Carried open actions</p>
                        {openActions.length ? (
                            <ul className="text-ink-2 mt-1 space-y-1">
                                {openActions.map(action => (
                                    <li key={action.id}>
                                        <ToolLink
                                            className="underline-offset-2 hover:underline"
                                            href={`/commitments?action=${encodeURIComponent(action.id)}`}
                                        >
                                            {action.title} · {action.owner}
                                        </ToolLink>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-ink-3 mt-1">None carried forward.</p>
                        )}
                    </div>
                    <div>
                        <p className="text-ink-3 font-medium">Comparable metrics</p>
                        {comparisons.length ? (
                            <ul className="text-ink-2 mt-1 space-y-1">
                                {comparisons.map(({ prior, current }) => (
                                    <li key={`${prior.id}-${current.id}`}>
                                        <button
                                            type="button"
                                            className="underline-offset-2 hover:underline"
                                            onClick={() =>
                                                onOpenObservation({
                                                    ref: `obs:${current.id}`,
                                                    label: `${current.metricName} · current week`,
                                                    date: `${current.periodStart} – ${current.periodEnd}`,
                                                })
                                            }
                                        >
                                            {current.metricName}: {prior.value} → {current.value}
                                        </button>
                                        <button
                                            type="button"
                                            className="text-ink-3 ml-2 underline-offset-2 hover:underline"
                                            onClick={() =>
                                                onOpenObservation({
                                                    ref: `obs:${prior.id}`,
                                                    label: `${prior.metricName} · previous week`,
                                                    date: `${prior.periodStart} – ${prior.periodEnd}`,
                                                })
                                            }
                                        >
                                            (open prior)
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-ink-3 mt-1">No directly comparable pair.</p>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

function ReportMetadata({ agenda }: { agenda: AgendaV1Dto }) {
    const period = agenda.reportPeriod;
    const execution = agenda.execution;
    const fallback: Record<string, string> = {
        "no-model": "No model configured",
        timeout: "Model timed out",
        "provider-error": "Provider error",
        "invalid-output": "Invalid model output",
    };
    return (
        <section
            aria-label="Saved report metadata"
            className="@max-md:grid-cols-1 grid gap-3 md:grid-cols-2"
        >
            <div className="border-line rounded-lg border p-4">
                <h2 className="text-ink text-sm font-semibold">
                    {period
                        ? period.kind === "completed-week"
                            ? "Complete week"
                            : "Week to date"
                        : "Legacy report"}
                </h2>
                {period ? (
                    <>
                        <p className="text-ink-2 mt-1 text-xs">
                            {formatReportingInstant(period.startInclusive)} →{" "}
                            {formatReportingInstant(period.endExclusive)} (end excluded)
                        </p>
                        <p className="text-ink-3 mt-2 text-xs">
                            Captured {formatReportingInstant(period.asOf)} · America/New_York
                        </p>
                    </>
                ) : (
                    <p className="text-ink-2 mt-1 text-xs">
                        Reporting period was not recorded. No cutoff has been assumed.
                    </p>
                )}
            </div>
            <div className="border-line rounded-lg border p-4">
                <h2 className="text-ink text-sm font-semibold">
                    {!execution
                        ? "Generation details unavailable"
                        : execution.outcome === "empty"
                          ? "Empty result"
                          : execution.mode === "ai"
                            ? "AI generated"
                            : execution.fallbackReason
                              ? "Rules fallback"
                              : "Rules generated"}
                </h2>
                {execution ? (
                    <>
                        <p className="text-ink-2 mt-1 text-xs">
                            {execution.fallbackReason
                                ? fallback[execution.fallbackReason]
                                : execution.outcome === "empty"
                                  ? "No eligible evidence; no provider failure."
                                  : execution.mode === "rules"
                                    ? "Rules mode; no provider failure."
                                    : `Model: ${execution.modelId ?? "Not recorded"}`}
                        </p>
                        <p className="text-ink-3 mt-2 text-xs">
                            {execution.attempts} provider{" "}
                            {execution.attempts === 1 ? "attempt" : "attempts"} ·{" "}
                            {(execution.durationMs / 1000).toFixed(1)}s · {execution.promptVersion}
                        </p>
                    </>
                ) : (
                    <p className="text-ink-2 mt-1 text-xs">
                        This legacy report has no saved execution record.
                    </p>
                )}
            </div>
        </section>
    );
}
