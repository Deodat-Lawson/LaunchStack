"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import type { WeeklyReviewDto } from "../api";
import { VantageApiError } from "../api";
import {
    v2Api,
    type V2Action,
    type V2Plan,
    type V2Settings,
    type V2Task,
    type V2TaskPatch,
} from "../v2-api";
import { Field, FormError, StatusWord } from "./Primitives";
import { ReviewCitationChips, reviewSources } from "./ReviewCitationChips";
import { useVantageFormat } from "../_lib/format";

const SAFE_REASONS = [
    "task_authority_revoked",
    "task_deadline",
    "task_execution_failed",
    "task_result_refs_invalid",
    "task_result_size",
    "task_read_failed",
    "task_source_unavailable",
    "task_provider_unavailable",
] as const;

/** Mounted only after the server confirms V2 visibility; no client-side env gate. */
export function V2PlanPanel({
    review,
    canEdit,
    onInspect,
}: {
    review: WeeklyReviewDto | null;
    canEdit: boolean;
    onInspect: (ref: string) => void;
}) {
    const t = useTranslations("vantage.v2");
    const [settings, setSettings] = useState<V2Settings | null>(null);
    const [goals, setGoals] = useState("");
    const [personas, setPersonas] = useState<string[]>([]);
    const [plan, setPlan] = useState<V2Plan | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState<Set<string>>(new Set());
    const [resetEpoch, setResetEpoch] = useState(0);
    const loadedVersions = useRef(new Map<string, number>());
    const alive = useRef(false);
    const pending = useRef(false);
    const reviewId = review?.id;
    const refresh = useCallback(
        async (discardDrafts = false) => {
            const response = reviewId ? await v2Api.plan(reviewId) : { plan: null };
            if (alive.current) {
                setPlan(response.plan);
                const previousVersions = loadedVersions.current;
                const versions = new Map(
                    response.plan?.tasks.map(task => [task.id, task.version]) ?? []
                );
                setDirty(previous =>
                    discardDrafts
                        ? new Set()
                        : new Set(
                              [...previous].filter(
                                  id =>
                                      versions.has(id) &&
                                      versions.get(id) === previousVersions.get(id)
                              )
                          )
                );
                loadedVersions.current = versions;
                if (discardDrafts) setResetEpoch(previous => previous + 1);
            }
        },
        [reviewId]
    );
    useEffect(() => {
        alive.current = true;
        let cancelled = false;
        setLoading(true);
        Promise.all([
            v2Api.settings(),
            reviewId ? v2Api.plan(reviewId) : Promise.resolve({ plan: null }),
        ])
            .then(([nextSettings, response]) => {
                if (cancelled) return;
                setSettings(nextSettings);
                setGoals(nextSettings.goals.join("\n"));
                setPersonas(nextSettings.personaIds);
                setPlan(response.plan);
                loadedVersions.current = new Map(
                    response.plan?.tasks.map(task => [task.id, task.version]) ?? []
                );
            })
            .catch(() => {
                if (!cancelled) setError(t("unavailable"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            alive.current = false;
        };
    }, [reviewId, t]);

    async function mutate(operation: () => Promise<unknown>, reload = true) {
        if (!canEdit || pending.current) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        try {
            await operation();
            if (reload) await refresh();
        } catch (cause) {
            if (!alive.current) return;
            if (cause instanceof VantageApiError && cause.status === 409) {
                // Approval is never replayed automatically against a newly fetched version.
                setError(t("stale"));
                try {
                    await refresh(true);
                } catch {
                    setError(t("refreshFailed"));
                }
            } else setError(t("unavailable"));
        } finally {
            pending.current = false;
            if (alive.current) setBusy(false);
        }
    }
    const approved =
        plan !== null && plan.approvedVersion === plan.version && plan.approvedHash === plan.hash;
    const active =
        plan?.tasks.some(task => task.status === "queued" || task.status === "running") === true;
    useEffect(() => {
        if (!active || busy || dirty.size > 0) return;
        const timer = setInterval(() => {
            void refresh().catch(() => setError(t("unavailable")));
        }, 5000);
        return () => clearInterval(timer);
    }, [active, busy, dirty.size, refresh, t]);
    const goalLines = goals
        .split("\n")
        .map(goal => goal.trim())
        .filter(Boolean);
    const validSettings =
        goalLines.length <= 10 &&
        goalLines.every(goal => goal.length <= 600) &&
        personas.length <= 12;
    const retrieval = review?.evidence.topicRetrieval;
    const degradation =
        retrieval && typeof retrieval === "object" && "degradation" in retrieval
            ? retrieval.degradation
            : null;
    const degraded =
        degradation !== null && typeof degradation === "object" && "reason" in degradation;
    return (
        <Card className="space-y-5 p-5" aria-busy={loading || busy}>
            <header className="space-y-1">
                <h2 className="text-ink font-semibold">{t("title")}</h2>
                <p className="text-ink-2 text-sm">{t("description")}</p>
            </header>
            {degraded ? (
                <p role="status" className="text-warn-ink text-sm">
                    {t("degraded")}
                </p>
            ) : null}
            <FormError message={error} />
            {settings ? (
                <fieldset disabled={!canEdit || busy} className="space-y-3">
                    <Field label={t("goals")} htmlFor="v2-goals" hint={t("goalsHint")}>
                        <Textarea
                            id="v2-goals"
                            value={goals}
                            onChange={event => setGoals(event.target.value)}
                        />
                    </Field>
                    <div className="space-y-2">
                        <p className="text-ink-2 text-sm">{t("agents")}</p>
                        {settings.personas.map(persona => (
                            <label key={persona.id} className="flex items-center gap-2">
                                <Checkbox
                                    checked={personas.includes(persona.id)}
                                    onCheckedChange={checked =>
                                        setPersonas(previous =>
                                            checked === true
                                                ? [...previous, persona.id]
                                                : previous.filter(id => id !== persona.id)
                                        )
                                    }
                                />
                                {persona.name}
                            </label>
                        ))}
                        {!settings.personas.length ? (
                            <p className="text-ink-3 text-sm">{t("noAgents")}</p>
                        ) : null}
                    </div>
                    <Button
                        variant="outline"
                        disabled={!validSettings}
                        onClick={() =>
                            void mutate(async () => {
                                const saved = await v2Api.saveSettings({
                                    goals: goals
                                        .split("\n")
                                        .map(goal => goal.trim())
                                        .filter(Boolean),
                                    personaIds: personas,
                                });
                                if (alive.current) {
                                    setSettings(saved);
                                    setGoals(saved.goals.join("\n"));
                                    setPersonas(saved.personaIds);
                                }
                            }, false)
                        }
                    >
                        {t("saveSettings")}
                    </Button>
                </fieldset>
            ) : null}
            {loading ? (
                <p role="status" className="text-ink-3 text-sm">
                    {t("loading")}
                </p>
            ) : review ? (
                plan ? (
                    <section className="space-y-4" aria-label={t("tree")}>
                        <div className="flex flex-wrap items-center gap-3">
                            <p className="text-ink-2 text-sm">
                                {t("version", { version: plan.version })}
                            </p>
                            <StatusWord tone={approved ? "success" : "quiet"}>
                                {t(approved ? "approved" : "unapproved")}
                            </StatusWord>
                            <Button
                                disabled={!canEdit || busy || approved || dirty.size > 0}
                                onClick={() => void mutate(() => v2Api.approve(plan))}
                            >
                                {t("approve")}
                            </Button>
                            <Button
                                variant="ghost"
                                disabled={busy || dirty.size > 0}
                                onClick={() => {
                                    setError(null);
                                    void refresh().catch(() => setError(t("unavailable")));
                                }}
                            >
                                {t("refresh")}
                            </Button>
                        </div>
                        <p className="text-ink-3 text-sm">{t("approvalHint")}</p>
                        <p className="text-ink-3 break-all font-mono text-xs">
                            {t("hash", { hash: plan.hash })}
                        </p>
                        {plan.tasks
                            .filter(task => task.parentId === null)
                            .map(root => (
                                <div
                                    key={root.id}
                                    className="border-line space-y-3 border-l-2 pl-4"
                                >
                                    <h3 className="font-semibold">{root.title}</h3>
                                    <p className="text-ink-2 whitespace-pre-wrap text-sm">
                                        {root.description}
                                    </p>
                                    {plan.tasks
                                        .filter(task => task.parentId === root.id)
                                        .map(task => (
                                            <V2TaskEditor
                                                key={`${task.id}:${task.version}:${resetEpoch}`}
                                                task={task}
                                                settings={settings}
                                                review={review}
                                                approved={approved}
                                                disabled={!canEdit || busy}
                                                onInspect={onInspect}
                                                onDirty={value =>
                                                    setDirty(previous => {
                                                        const next = new Set(previous);
                                                        if (value) next.add(task.id);
                                                        else next.delete(task.id);
                                                        return next;
                                                    })
                                                }
                                                onSave={patch =>
                                                    void mutate(() => v2Api.edit(task, patch))
                                                }
                                                onDelete={() =>
                                                    void mutate(() => v2Api.remove(task))
                                                }
                                                onAction={(action, result) =>
                                                    void mutate(() =>
                                                        v2Api.action(task, action, result)
                                                    )
                                                }
                                            />
                                        ))}
                                </div>
                            ))}
                        {plan.discarded.length ? (
                            <p className="text-ink-3 text-sm">
                                {t("discarded", { count: plan.discarded.length })}
                            </p>
                        ) : null}
                    </section>
                ) : (
                    <Button
                        disabled={!canEdit || busy}
                        onClick={() => void mutate(() => v2Api.create(review.id))}
                    >
                        {t("create")}
                    </Button>
                )
            ) : (
                <p className="text-ink-3 text-sm">{t("needsBrief")}</p>
            )}
        </Card>
    );
}

function V2TaskEditor({
    task,
    settings,
    review,
    approved,
    disabled,
    onInspect,
    onDirty,
    onSave,
    onDelete,
    onAction,
}: {
    task: V2Task;
    settings: V2Settings | null;
    review: WeeklyReviewDto;
    approved: boolean;
    disabled: boolean;
    onInspect: (ref: string) => void;
    onDirty: (dirty: boolean) => void;
    onSave: (patch: V2TaskPatch) => void;
    onDelete: () => void;
    onAction: (action: V2Action, result?: string) => void;
}) {
    const t = useTranslations("vantage.v2");
    const fmt = useVantageFormat();
    const reasonText = (reason: string) => {
        const known = SAFE_REASONS.find(code => code === reason);
        return known ? t(`reasons.${known}`) : t("reasons.unknown");
    };
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [acceptanceCriterion, setAcceptanceCriterion] = useState(task.acceptanceCriterion);
    const [priority, setPriority] = useState(task.priority);
    const [assignee, setAssignee] = useState(
        task.assigneeType === "owner" ? "owner" : task.assigneeId
    );
    const [notes, setNotes] = useState("");
    const [changed, setChanged] = useState(false);
    function change() {
        setChanged(true);
        onDirty(true);
    }
    const terminal = task.status === "completed" || task.status === "cancelled";
    const expired =
        task.status === "running" &&
        !!task.latestAttempt?.leaseUntil &&
        Date.parse(task.latestAttempt.leaseUntil) <= Date.now();
    const selectedPersonas =
        settings?.personas.filter(persona => settings.personaIds.includes(persona.id)) ?? [];
    const topic = review.report.topics.find(item => item.id === task.topicId);
    return (
        <article className="border-line space-y-3 rounded-lg border p-4" aria-label={task.title}>
            {topic ? <p className="text-ink-3 text-sm">{topic.title}</p> : null}
            <StatusWord
                tone={
                    task.status === "failed"
                        ? "danger"
                        : task.status === "completed"
                          ? "success"
                          : "quiet"
                }
            >
                {t(`status.${task.status}`)}
            </StatusWord>
            {task.reason || expired ? (
                <p className="text-ink-2 text-sm">
                    {t("reason", { reason: reasonText(task.reason ?? "task_deadline") })}
                </p>
            ) : null}
            {task.latestAttempt ? (
                <div className="text-ink-3 space-y-1 text-sm">
                    <p>
                        {t("latestAttempt", {
                            number: task.latestAttempt.number,
                            status: t(`status.${task.latestAttempt.status}`),
                        })}
                    </p>
                    {task.latestAttempt.reason ? (
                        <p>{t("reason", { reason: reasonText(task.latestAttempt.reason) })}</p>
                    ) : null}
                    {task.latestAttempt.leaseUntil ? (
                        <p>
                            {t("attemptLease", {
                                date: fmt.dateTime(task.latestAttempt.leaseUntil),
                            })}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <fieldset disabled={disabled} className="space-y-3">
                <Field label={t("taskTitle")} htmlFor={`${task.id}-title`}>
                    <Input
                        id={`${task.id}-title`}
                        value={title}
                        maxLength={200}
                        onChange={event => {
                            setTitle(event.target.value);
                            change();
                        }}
                    />
                </Field>
                <Field label={t("taskDescription")} htmlFor={`${task.id}-description`}>
                    <Textarea
                        id={`${task.id}-description`}
                        value={description}
                        maxLength={3000}
                        onChange={event => {
                            setDescription(event.target.value);
                            change();
                        }}
                    />
                </Field>
                <Field label={t("acceptanceCriterion")} htmlFor={`${task.id}-acceptance`}>
                    <Textarea
                        id={`${task.id}-acceptance`}
                        value={acceptanceCriterion}
                        maxLength={1000}
                        onChange={event => {
                            setAcceptanceCriterion(event.target.value);
                            change();
                        }}
                    />
                </Field>
                <Field label={t("priority")}>
                    <Select
                        value={priority}
                        onValueChange={value => {
                            setPriority(value as V2Task["priority"]);
                            change();
                        }}
                    >
                        <SelectTrigger aria-label={t("priority")}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(["low", "medium", "high"] as const).map(value => (
                                <SelectItem key={value} value={value}>
                                    {t(`priorities.${value}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label={t("assignee")}>
                    <Select
                        value={assignee}
                        onValueChange={value => {
                            setAssignee(value);
                            change();
                        }}
                    >
                        <SelectTrigger aria-label={t("assignee")}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="owner">{t("owner")}</SelectItem>
                            {selectedPersonas.map(persona => (
                                <SelectItem key={persona.id} value={persona.id}>
                                    {persona.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        disabled={
                            !changed ||
                            !title.trim() ||
                            !description.trim() ||
                            !acceptanceCriterion.trim()
                        }
                        onClick={() =>
                            onSave({
                                title,
                                description,
                                acceptanceCriterion,
                                priority,
                                assigneeType: assignee === "owner" ? "owner" : "persona",
                                assigneeId: assignee === "owner" ? "" : assignee,
                            })
                        }
                    >
                        {t("saveTask")}
                    </Button>
                    <Button variant="ghost" onClick={onDelete}>
                        {t("deleteTask")}
                    </Button>
                </div>
            </fieldset>
            {task.provenance === "grounded" && task.refs.length ? (
                <ReviewCitationChips
                    refs={task.refs}
                    sources={reviewSources(review)}
                    onInspect={onInspect}
                />
            ) : (
                <p className="text-ink-3 text-sm">{t("uncited")}</p>
            )}
            {task.structuredResult ? (
                <section className="bg-panel-2 space-y-3 rounded-md p-3" aria-label={t("result")}>
                    <h4>{t("result")}</h4>
                    <p className="whitespace-pre-wrap text-sm">{task.structuredResult.summary}</p>
                    {task.structuredResult.claims.length ? (
                        <div className="space-y-2">
                            <h5>{t("findings")}</h5>
                            {task.structuredResult.claims.map((claim, index) => (
                                <div key={index} className="space-y-1">
                                    <p className="whitespace-pre-wrap text-sm">{claim.text}</p>
                                    <ReviewCitationChips
                                        refs={claim.refs}
                                        sources={reviewSources(review)}
                                        onInspect={onInspect}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {task.structuredResult.unknowns.length ? (
                        <div>
                            <h5>{t("openQuestions")}</h5>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                                {task.structuredResult.unknowns.map((question, index) => (
                                    <li key={index}>{question}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    <p className="text-ink-3 text-sm">
                        {t(
                            task.structuredResult.disposition === "blocked"
                                ? "resultBlocked"
                                : "resultReview"
                        )}
                    </p>
                </section>
            ) : task.result ? (
                <div className="bg-panel-2 space-y-1 rounded-md p-3">
                    <h4>{t("result")}</h4>
                    <p className="whitespace-pre-wrap text-sm">{task.result}</p>
                </div>
            ) : null}
            {approved && !terminal ? (
                <fieldset disabled={disabled || changed} className="space-y-3">
                    {task.assigneeType === "owner" ? (
                        <Field
                            label={t("notes")}
                            htmlFor={`${task.id}-notes`}
                            hint={t("manualHint")}
                        >
                            <Textarea
                                id={`${task.id}-notes`}
                                value={notes}
                                maxLength={12000}
                                onChange={event => setNotes(event.target.value)}
                            />
                        </Field>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {task.assigneeType === "persona" &&
                        (task.status === "queued" ||
                            task.status === "failed" ||
                            task.status === "blocked" ||
                            expired) ? (
                            <Button onClick={() => onAction("run")}>{t("run")}</Button>
                        ) : null}
                        {task.status === "submitted" ? (
                            <>
                                <Button onClick={() => onAction("accept")}>{t("accept")}</Button>
                                <Button variant="outline" onClick={() => onAction("rework")}>
                                    {t("rework")}
                                </Button>
                            </>
                        ) : null}
                        {task.assigneeType === "owner" ? (
                            <Button
                                disabled={!notes.trim()}
                                onClick={() => onAction("complete", notes)}
                            >
                                {t("complete")}
                            </Button>
                        ) : null}
                        <Button variant="ghost" onClick={() => onAction("cancel")}>
                            {t("cancel")}
                        </Button>
                    </div>
                </fieldset>
            ) : null}
        </article>
    );
}
