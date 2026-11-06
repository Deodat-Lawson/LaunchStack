"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { WeeklyBrief } from "../../tools/vantage/_components/WeeklyBrief";
import { CompactTopicRow } from "../../tools/vantage/_components/CompactTopicRow";
import { TopicDetailSheet } from "../../tools/vantage/_components/TopicDetailSheet";
import { demoSourceKey, demoSourceName } from "../../tools/vantage/demo-api";
import type {
    DemoHumanDecision,
    DemoSource,
    DemoSourceRef,
    DemoTopic,
    DemoTopicReview,
} from "../../tools/vantage/demo-contract";
import type {
    RoleContextualState,
    RoleSelectionProvenance,
} from "../../tools/vantage/role-contextual-contract";
import type { PersonalContextViewV0 } from "~/lib/vantage/personal-context";
import styles from "./roles-review.module.css";

interface ArchitectureState {
    revision: number;
    state: "reviewed" | "unknowns-marked" | "unreviewed";
    projectionFingerprint: string;
    available: boolean;
    projection: {
        status: "available" | "partial" | "blocked";
        facts: {
            path: string;
            label: string;
            value: string;
            subject?: string;
            basis: string;
            sources: { documentId: string; versionId: string | null; quote: string | null }[];
        }[];
        unknowns: { code: string; count?: number }[];
        includedFactPaths: string[];
        omittedFactCount: number;
    };
}

interface PersonalRoleView extends PersonalContextViewV0 {
    directory: {
        mapVersion: string;
        roles: {
            id: string;
            label: string;
            description: string;
            responsibilities: string[];
            agendaPriorities: string[];
        }[];
    };
    mapping: {
        persistedVersion: string | null;
        currentVersion: string;
        requiresConfirmation: boolean;
    };
}

const endpoint = "/api/vantage/role-contextual";
const selectedRoles = ["partnerships-lead", "security-engineer"] as const;
type PrimaryRole = (typeof selectedRoles)[number];
const decisionLabels: Record<DemoHumanDecision["value"], string> = {
    go: "Go",
    "no-go": "No-go",
    "needs-more-evidence": "Needs more evidence",
};

class ContextRequestError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, { ...init, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : "The request could not be completed.";
        throw new ContextRequestError(response.status, message);
    }
    return body as T;
}
function reportPath(id: string) {
    return endpoint + "/reports/" + encodeURIComponent(id);
}
function accessChanged(reason: unknown) {
    return reason instanceof ContextRequestError && [401, 403, 404, 409].includes(reason.status);
}
function isPrimary(value: string | undefined): value is PrimaryRole {
    return value === "partnerships-lead" || value === "security-engineer";
}
function includesBothRoles(view: PersonalRoleView) {
    const ids = view.state.roles?.roleIds ?? [];
    return ids.length === selectedRoles.length && selectedRoles.every(id => ids.includes(id));
}
function roleLabel(id: string | undefined, view: PersonalRoleView | null) {
    if (!id) return "Unspecified";
    return view?.directory.roles.find(role => role.id === id)?.label ?? id;
}
function frozenRoleLabel(
    id: string | undefined,
    mappingVersion: string,
    view: PersonalRoleView | null
) {
    if (!id) return "Unspecified";
    return view?.directory.mapVersion === mappingVersion
        ? roleLabel(id, view)
        : id + " (saved role ID)";
}

export function RoleReview() {
    const [state, setState] = useState<RoleContextualState | null>(null);
    const [personal, setPersonal] = useState<PersonalRoleView | null>(null);
    const [primary, setPrimary] = useState<PrimaryRole | undefined>();
    const [architectureReady, setArchitectureReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [topicId, setTopicId] = useState<string | null>(null);
    const [source, setSource] = useState<DemoSourceRef | null>(null);
    const [decisionTopicId, setDecisionTopicId] = useState<string | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const running = useRef(false);
    const report = state?.report ?? null;
    const topic = report?.topics.find(item => item.id === topicId) ?? null;
    const decisionTopic = report?.topics.find(item => item.id === decisionTopicId) ?? null;
    const persistedPrimary = personal?.state.roles?.primaryRoleId;
    const personalReady =
        !!personal &&
        personal.ready &&
        includesBothRoles(personal) &&
        personal.roles.userConfirmed &&
        !personal.roles.fallback &&
        !personal.mapping.requiresConfirmation &&
        isPrimary(persistedPrimary) &&
        persistedPrimary === primary;
    const alreadyPrepared =
        !!state &&
        !!personal &&
        !!primary &&
        state.reports.some(
            item =>
                item.roleSelection.primaryRoleId === primary &&
                item.roleSelection.revision === personal.state.revision &&
                item.roleSelection.mappingVersion === personal.mapping.currentVersion
        );

    useEffect(() => {
        const controller = new AbortController();
        Promise.all([
            request<RoleContextualState>(endpoint, { signal: controller.signal }),
            request<PersonalRoleView>(endpoint + "/personal", { signal: controller.signal }),
        ])
            .then(([next, roles]) => {
                setState(next);
                setPersonal(roles);
                setPrimary(
                    isPrimary(roles.state.roles?.primaryRoleId)
                        ? roles.state.roles.primaryRoleId
                        : undefined
                );
            })
            .catch(reason => {
                if (!controller.signal.aborted)
                    setError(
                        reason instanceof Error ? reason.message : "Could not load this review."
                    );
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, []);

    function closeDetails() {
        setTopicId(null);
        setSource(null);
        setDecisionTopicId(null);
    }
    function unavailable() {
        setState(null);
        setPersonal(null);
        setArchitectureReady(false);
        closeDetails();
        setError(
            "The report, its sources, or your access changed. Content is hidden until it can be reloaded."
        );
    }
    async function reloadSaved(id?: string, message = "The saved review was reloaded.") {
        setLoading(true);
        setError(null);
        setNotice(null);
        setArchitectureReady(false);
        setState(null);
        setPersonal(null);
        closeDetails();
        try {
            const [next, roles] = await Promise.all([
                request<RoleContextualState>(id ? reportPath(id) : endpoint),
                request<PersonalRoleView>(endpoint + "/personal"),
            ]);
            setState(next);
            setPersonal(roles);
            setPrimary(
                isPrimary(roles.state.roles?.primaryRoleId)
                    ? roles.state.roles.primaryRoleId
                    : undefined
            );
            setNotice(message);
            return true;
        } catch (reason) {
            setError(
                reason instanceof Error ? reason.message : "The saved review could not be reloaded."
            );
            return false;
        } finally {
            setLoading(false);
        }
    }
    async function savePreference() {
        if (!personal || !primary || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const updated = await request<PersonalRoleView>(endpoint + "/personal", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    expectedRevision: personal.state.revision,
                    roleIds: [...selectedRoles],
                    primaryRoleId: primary,
                }),
            });
            setPersonal(updated);
            setPrimary(
                isPrimary(updated.state.roles?.primaryRoleId)
                    ? updated.state.roles.primaryRoleId
                    : undefined
            );
            setNotice(
                "Primary role preference saved. Existing reports retain their original perspective."
            );
        } catch (reason) {
            if (reason instanceof ContextRequestError && reason.status === 409) {
                await reloadSaved(
                    report?.id,
                    "Your role preference changed. The latest saved state was reloaded; review it before saving again."
                );
            } else {
                if (accessChanged(reason)) unavailable();
                setError(
                    reason instanceof Error ? reason.message : "Could not save the role preference."
                );
            }
        } finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function prepare() {
        if (!state || !personalReady || !architectureReady || alreadyPrepared || running.current)
            return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const next = await request<RoleContextualState>(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weekStart: state.selectedWeek }),
            });
            setState(next);
            closeDetails();
            setNotice("The deterministic review was saved for the current primary role.");
        } catch (reason) {
            if (reason instanceof ContextRequestError && reason.status === 409) {
                const rechecked = await reloadSaved(
                    report?.id,
                    "The new report was not saved. The current saved state was rechecked."
                );
                if (rechecked) setError(reason.message);
            } else {
                if (accessChanged(reason)) unavailable();
                setError(
                    reason instanceof Error ? reason.message : "Could not prepare the review."
                );
            }
        } finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function saveReview(
        selected: DemoTopic,
        changes: Pick<DemoTopicReview, "status" | "decision">
    ) {
        if (!report || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const next = await request<RoleContextualState>(reportPath(report.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topicId: selected.id,
                    expectedVersion: report.version,
                    ...changes,
                }),
            });
            setState(next);
            setDecisionTopicId(null);
            setNotice("Review saved. No action or commitment was created.");
        } catch (reason) {
            if (reason instanceof ContextRequestError && reason.status === 409) {
                await reloadSaved(
                    report.id,
                    "The report or its sources changed. Review the reloaded version before trying again."
                );
            } else {
                if (accessChanged(reason)) unavailable();
                setError(reason instanceof Error ? reason.message : "Could not save the review.");
            }
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Vantage / Paired roles</p>
                    <h1 className={styles.heading}>Weekly role review</h1>
                    <p className={styles.subheading}>
                        Compare two primary perspectives with their frozen source and history
                        provenance.
                    </p>
                </div>
                <Button
                    variant="outline"
                    disabled={loading || busy}
                    onClick={() => void reloadSaved(report?.id)}
                >
                    Reload saved review
                </Button>
            </header>
            <aside className={styles.banner} aria-label="Replay disclosure">
                <strong>Deterministic simulated generation</strong>
                <p>
                    This isolated scenario uses synthetic sources and authored replay output. No
                    live Generation or model Judge is used. It checks the workflow, not model
                    quality. This synthetic adaptation uses the original benchmark cutoff of
                    November 2, 2026, 14:00 UTC.
                </p>
            </aside>
            {loading && (
                <p role="status" className={styles.status}>
                    Loading the saved review...
                </p>
            )}
            {error && (
                <p role="alert" className={styles.error}>
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className={styles.status}>
                    {notice}
                </p>
            )}
            {!loading && state?.unavailableReason && (
                <p role="alert" className={styles.error}>
                    Saved content is unavailable with the current sources or access. Reload to check
                    again.
                </p>
            )}
            {!loading && state && personal && (
                <>
                    <section className={styles.context} aria-label="Primary role preference">
                        <div className={styles.sectionHeading}>
                            <h2>Primary role preference</h2>
                            <p>Personal revision {personal.state.revision}</p>
                        </div>
                        <p className={styles.contextIntro}>
                            This paired scenario uses both listed responsibilities. Choose which
                            should lead the next review and save your preference. The preference
                            does not grant access.
                        </p>
                        <fieldset className={styles.roleChoices} disabled={busy}>
                            <legend className={styles.roleLegend}>Primary perspective</legend>
                            {selectedRoles.map(id => {
                                const role = personal.directory.roles.find(item => item.id === id);
                                return (
                                    <label className={styles.roleChoice} key={id}>
                                        <input
                                            type="radio"
                                            name="primary-role"
                                            value={id}
                                            checked={primary === id}
                                            onChange={() => setPrimary(id)}
                                        />
                                        <span>
                                            <strong>{role?.label ?? id}</strong>
                                            <small>{role?.description}</small>
                                        </span>
                                    </label>
                                );
                            })}
                        </fieldset>
                        <p className={styles.contextIntro}>
                            Saved primary: {roleLabel(persistedPrimary, personal)}. Mapping:{" "}
                            {personal.mapping.currentVersion}.
                            {personal.mapping.requiresConfirmation
                                ? " Reconfirm this selection for the current mapping."
                                : ""}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={
                                busy || !primary || (personalReady && primary === persistedPrimary)
                            }
                            onClick={() => void savePreference()}
                        >
                            Save primary role
                        </Button>
                    </section>
                    <CompanyContext
                        onReadyChange={setArchitectureReady}
                        hasSavedReport={state.reports.length > 0}
                        onUnavailable={unavailable}
                    />
                    <section className={styles.context} aria-label="Saved role reports">
                        <div className={styles.sectionHeading}>
                            <h2>Saved reports</h2>
                            <p>{state.reports.length} saved</p>
                        </div>
                        {state.reports.length ? (
                            <ul className={styles.reportList}>
                                {state.reports.map(item => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={styles.reportButton}
                                            aria-current={
                                                item.id === report?.id ? "true" : undefined
                                            }
                                            disabled={busy || loading}
                                            onClick={() =>
                                                void reloadSaved(
                                                    item.id,
                                                    "The selected saved report was loaded."
                                                )
                                            }
                                        >
                                            <span>
                                                <strong>
                                                    {frozenRoleLabel(
                                                        item.roleSelection.primaryRoleId,
                                                        item.roleSelection.mappingVersion,
                                                        personal
                                                    )}
                                                </strong>
                                                <small>
                                                    Week {item.weekStart} / version {item.version} /
                                                    report {item.id}
                                                </small>
                                            </span>
                                            <span>
                                                {item.id === report?.id ? "Viewing" : "Open"}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={styles.contextIntro}>
                                No reports have been saved for this week.
                            </p>
                        )}
                        <p className={styles.contextIntro}>
                            Each report keeps the role and context captured when it was prepared.
                        </p>
                        <Button
                            disabled={
                                busy || !personalReady || !architectureReady || alreadyPrepared
                            }
                            onClick={() => void prepare()}
                        >
                            {busy ? "Preparing..." : "Prepare report for primary role"}
                        </Button>
                        {alreadyPrepared && (
                            <p className={styles.contextIntro}>
                                A report for this saved preference revision is already available.
                                Open it above.
                            </p>
                        )}
                    </section>
                </>
            )}
            {!loading && report && personal && (
                <div className={styles.content}>
                    <section
                        className={styles.reportIdentity}
                        aria-label="Frozen report perspective"
                    >
                        <p className={styles.eyebrow}>Saved report perspective</p>
                        <h2>
                            {frozenRoleLabel(
                                report.roleSelection.primaryRoleId,
                                report.roleSelection.mappingVersion,
                                personal
                            )}
                        </h2>
                        <p>
                            Week {report.weekStart} / report version {report.version} / role
                            revision {report.roleSelection.revision}
                        </p>
                        {persistedPrimary !== report.roleSelection.primaryRoleId && (
                            <p>
                                The current preference is {roleLabel(persistedPrimary, personal)};
                                this report retains its saved perspective.
                            </p>
                        )}
                        <details>
                            <summary>Frozen role and context provenance</summary>
                            <Provenance
                                selection={report.roleSelection}
                                sourceSetHash={report.sourceSetHash}
                                historyHash={report.historyHash}
                                contextKey={report.contextKey}
                                personal={personal}
                            />
                        </details>
                    </section>
                    <WeeklyBrief report={report} />
                    <section aria-label="Decisions to review">
                        <div className={styles.sectionHeading}>
                            <h2>Decisions to review</h2>
                            <p>
                                {report.topics.length}{" "}
                                {report.topics.length === 1 ? "topic" : "topics"}
                            </p>
                        </div>
                        <div className={styles.topicList}>
                            {report.topics.map(item => (
                                <CompactTopicRow
                                    key={item.id}
                                    topic={item}
                                    report={report}
                                    selected={topicId === item.id}
                                    onOpen={element => {
                                        trigger.current = element;
                                        setTopicId(item.id);
                                    }}
                                />
                            ))}
                        </div>
                    </section>
                    <details className={styles.details}>
                        <summary>Sources and report details</summary>
                        <ul>
                            {report.diagnostics.sources.map(item => (
                                <li key={demoSourceKey(item.source)}>
                                    <button
                                        type="button"
                                        className={styles.sourceButton}
                                        onClick={() => setSource(item.source)}
                                    >
                                        {item.title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </details>
                    <p className={styles.footer}>
                        Saved report / deterministic replay / no model Judge. Source references
                        identify supplied content; they do not verify the interpretation.
                    </p>
                </div>
            )}
            {report && topic && (
                <TopicDetailSheet
                    open
                    topic={topic}
                    report={report}
                    busy={busy}
                    triggerRef={trigger}
                    onOpenChange={open => {
                        if (!open) setTopicId(null);
                    }}
                    onSource={setSource}
                    onReview={status => void saveReview(topic, { status })}
                    onDecision={() => setDecisionTopicId(topic.id)}
                />
            )}
            {report && source && (
                <SourceDialog
                    reportId={report.id}
                    sourceRef={source}
                    onClose={() => setSource(null)}
                    onUnavailable={unavailable}
                />
            )}
            {decisionTopic && (
                <DecisionDialog
                    key={decisionTopic.id}
                    topic={decisionTopic}
                    busy={busy}
                    onClose={() => setDecisionTopicId(null)}
                    onSave={value => void saveReview(decisionTopic, { decision: value })}
                />
            )}
        </main>
    );
}

function Provenance({
    selection,
    sourceSetHash,
    historyHash,
    contextKey,
    personal,
}: {
    selection: RoleSelectionProvenance;
    sourceSetHash: string;
    historyHash: string;
    contextKey: string;
    personal: PersonalRoleView;
}) {
    return (
        <dl className={styles.provenanceList}>
            <dt>Selected responsibilities</dt>
            <dd>
                {selection.roleIds
                    .map(id => frozenRoleLabel(id, selection.mappingVersion, personal))
                    .join(", ") || "None"}
            </dd>
            <dt>Primary role</dt>
            <dd>{frozenRoleLabel(selection.primaryRoleId, selection.mappingVersion, personal)}</dd>
            <dt>Role mapping</dt>
            <dd>{selection.mappingVersion}</dd>
            <dt>Persisted mapping</dt>
            <dd>{selection.persistedMappingVersion ?? "Not supplied"}</dd>
            <dt>Confirmed / fallback</dt>
            <dd>
                {selection.userConfirmed ? "Confirmed" : "Unconfirmed"} /{" "}
                {selection.fallback ? "fallback" : "no fallback"}
            </dd>
            <dt>Source set hash</dt>
            <dd>{sourceSetHash}</dd>
            <dt>History hash</dt>
            <dd>{historyHash}</dd>
            <dt>Context key</dt>
            <dd>{contextKey}</dd>
        </dl>
    );
}
function CompanyContext({
    onReadyChange,
    hasSavedReport,
    onUnavailable,
}: {
    onReadyChange: (ready: boolean) => void;
    hasSavedReport: boolean;
    onUnavailable: () => void;
}) {
    const [context, setContext] = useState<ArchitectureState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const running = useRef(false);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setContext(null);
        onReadyChange(false);
        request<ArchitectureState>(endpoint + "/architecture", { signal: controller.signal })
            .then(value => {
                setContext(value);
                onReadyChange(value.available && value.state !== "unreviewed");
            })
            .catch(reason => {
                if (!controller.signal.aborted) {
                    if (accessChanged(reason)) unavailable.current();
                    else
                        setError(
                            reason instanceof Error
                                ? reason.message
                                : "Could not load company context."
                        );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [onReadyChange, refresh]);

    async function confirmReview() {
        if (!context?.available || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        const state =
            context.projection.unknowns.length || context.projection.omittedFactCount
                ? "unknowns-marked"
                : "reviewed";
        try {
            await request(endpoint + "/architecture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    expectedRevision: context.revision,
                    expectedProjectionFingerprint: context.projectionFingerprint,
                    state,
                }),
            });
            const current = await request<ArchitectureState>(endpoint + "/architecture");
            setContext(current);
            onReadyChange(current.available && current.state !== "unreviewed");
            setConfirming(false);
            if (!current.available || current.state !== state) {
                onReadyChange(false);
                setError("Company context changed after review. Inspect the current projection.");
                return;
            }
            setNotice("Company context review saved for this exact projection.");
        } catch (reason) {
            if (accessChanged(reason)) {
                setContext(null);
                onReadyChange(false);
                setConfirming(false);
                if (reason instanceof ContextRequestError && reason.status === 409) {
                    setNotice(
                        "Company context changed. Inspect the current projection before reviewing again."
                    );
                    setRefresh(value => value + 1);
                } else {
                    unavailable.current();
                }
            }
            setError(
                reason instanceof Error ? reason.message : "Could not save the context review."
            );
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    return (
        <section className={styles.context} aria-label="Company context review">
            <div className={styles.sectionHeading}>
                <h2>Company context</h2>
                <p>{context ? context.state.replaceAll("-", " ") : "Checking"}</p>
            </div>
            {loading && <p role="status">Checking the authorized context...</p>}
            {error && (
                <p role="alert" className={styles.contextError}>
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className={styles.contextNotice}>
                    {notice}
                </p>
            )}
            {!loading && !context && (
                <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>
                    Reload company context
                </Button>
            )}
            {context && (
                <>
                    <p className={styles.contextIntro}>
                        Projection: {context.projection.status}. Review applies to the displayed
                        projection, not to the truth of every source claim.
                    </p>
                    <details open={context.state === "unreviewed" ? true : undefined}>
                        <summary>Inspect authorized facts, sources, and unknowns</summary>
                        {context.projection.facts.length ? (
                            <dl className={styles.facts}>
                                {context.projection.facts.map(fact => (
                                    <div key={fact.path} className={styles.fact}>
                                        <dt>
                                            {fact.label}
                                            {fact.subject ? " / " + fact.subject : ""}
                                        </dt>
                                        <dd>{fact.value}</dd>
                                        <dd className={styles.provenance}>
                                            {fact.path} / {fact.basis}
                                        </dd>
                                        {fact.sources.map((source, index) => (
                                            <dd key={index} className={styles.provenance}>
                                                Document {source.documentId} / version{" "}
                                                {source.versionId ?? "not supplied"}
                                                {source.quote && (
                                                    <blockquote>{source.quote}</blockquote>
                                                )}
                                            </dd>
                                        ))}
                                        {!fact.sources.length && (
                                            <dd className={styles.provenance}>
                                                No source supplied.
                                            </dd>
                                        )}
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className={styles.contextIntro}>
                                No authorized facts are available.
                            </p>
                        )}
                        <h3 className={styles.contextSubheading}>Unknowns</h3>
                        {context.projection.unknowns.length ? (
                            <ul className={styles.unknownList}>
                                {context.projection.unknowns.map((unknown, index) => (
                                    <li key={index}>
                                        {unknown.code}
                                        {unknown.count !== undefined
                                            ? " (" + unknown.count + ")"
                                            : ""}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={styles.contextIntro}>No unknowns supplied.</p>
                        )}
                        <p className={styles.contextIntro}>
                            Omitted facts: {context.projection.omittedFactCount}. Only facts
                            authorized for this workspace are shown.
                        </p>
                        {context.available && !hasSavedReport && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => setConfirming(true)}
                            >
                                {context.state === "unreviewed"
                                    ? "Review company context"
                                    : "Review company context again"}
                            </Button>
                        )}
                        {hasSavedReport && (
                            <p className={styles.contextIntro}>
                                The saved report is bound to this context review.
                            </p>
                        )}
                    </details>
                    {!context.available && (
                        <p role="status" className={styles.contextNotice}>
                            Context is not available for review. Resolve the missing source or
                            profile information before preparing a report.
                        </p>
                    )}
                    {confirming && (
                        <Dialog open onOpenChange={open => !open && !busy && setConfirming(false)}>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Confirm company context review</DialogTitle>
                                    <DialogDescription>
                                        Confirm that you inspected the displayed facts, their source
                                        references, and the listed unknowns for this exact
                                        projection.
                                    </DialogDescription>
                                </DialogHeader>
                                <p className="text-ink-3 text-sm">
                                    {context.projection.unknowns.length ||
                                    context.projection.omittedFactCount
                                        ? "The review will record that unknowns or omissions remain."
                                        : "The review will record this projection as reviewed."}
                                </p>
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => setConfirming(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button disabled={busy} onClick={() => void confirmReview()}>
                                        {busy ? "Saving..." : "Confirm context review"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                </>
            )}
        </section>
    );
}
function SourceDialog({
    reportId,
    sourceRef,
    onClose,
    onUnavailable,
}: {
    reportId: string;
    sourceRef: DemoSourceRef;
    onClose: () => void;
    onUnavailable: () => void;
}) {
    const [source, setSource] = useState<DemoSource | null>(null);
    const [error, setError] = useState<string | null>(null);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;

    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams({
            kind: sourceRef.kind,
            id: sourceRef.id,
            version: sourceRef.version,
        });
        request<DemoSource>(reportPath(reportId) + "/source?" + query.toString(), {
            signal: controller.signal,
        })
            .then(value => setSource(value))
            .catch(reason => {
                if (controller.signal.aborted) return;
                if (accessChanged(reason)) unavailable.current();
                else
                    setError(
                        reason instanceof Error ? reason.message : "Could not open this source."
                    );
            });
        return () => controller.abort();
    }, [reportId, sourceRef]);

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[720px]">
                <DialogHeader>
                    <DialogTitle>{source?.title ?? "Open exact source"}</DialogTitle>
                    <DialogDescription className="break-all">
                        {demoSourceName(sourceRef)}
                    </DialogDescription>
                </DialogHeader>
                {!source && !error && <p role="status">Checking access to the exact source...</p>}
                {error && <p role="alert">{error}</p>}
                {source && (
                    <>
                        <p className="text-ink-3 text-xs">
                            Exact version {source.source.version}
                            {source.sourceDate ? " / " + source.sourceDate.slice(0, 10) : ""}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {source.body}
                        </p>
                        <p className="text-ink-3 text-xs">{source.authority}</p>
                        <details className="text-ink-3 text-xs">
                            <summary>Content provenance</summary>
                            <p className="mt-2 break-all">SHA-256 {source.contentHash}</p>
                        </details>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function DecisionDialog({
    topic,
    busy,
    onClose,
    onSave,
}: {
    topic: DemoTopic;
    busy: boolean;
    onClose: () => void;
    onSave: (decision: NonNullable<DemoTopicReview["decision"]>) => void;
}) {
    const [value, setValue] = useState<DemoHumanDecision["value"] | undefined>();
    const [note, setNote] = useState(topic.decision?.text ?? "");
    return (
        <Dialog open onOpenChange={open => !open && !busy && onClose()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Confirm your decision</DialogTitle>
                    <DialogDescription>{topic.decisionQuestion}</DialogDescription>
                </DialogHeader>
                <p className="text-ink-3 text-xs">
                    Select your outcome below; no option is preselected.
                </p>
                <fieldset disabled={busy} className="space-y-2">
                    <legend className="text-ink-3 mb-2 text-xs">Your review outcome</legend>
                    {(Object.keys(decisionLabels) as DemoHumanDecision["value"][]).map(choice => (
                        <label
                            key={choice}
                            className="border-line flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm"
                        >
                            <input
                                type="radio"
                                name="role-decision"
                                value={choice}
                                checked={value === choice}
                                onChange={() => setValue(choice)}
                            />
                            {decisionLabels[choice]}
                        </label>
                    ))}
                </fieldset>
                <label className="text-ink-3 space-y-2 text-xs">
                    Decision note (optional)
                    <Textarea
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        maxLength={1000}
                        disabled={busy}
                        placeholder="What did you decide, and what evidence informed it?"
                    />
                </label>
                <p className="text-ink-3 text-xs leading-relaxed">
                    This records your decision. It does not create a commitment or verify work.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        disabled={busy || !value}
                        onClick={() => {
                            if (value)
                                onSave({ value, ...(note.trim() ? { text: note.trim() } : {}) });
                        }}
                    >
                        {busy ? "Saving..." : "Confirm and save decision"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
