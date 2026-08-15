"use client";

import { useEffect, useMemo, useState } from "react";

// Import from submodules, never the package barrel: the barrel re-exports
// db.ts / generator.ts, which pull `getDb` and the LLM client into the client
// bundle. Everything imported here is pure (no DB, no network, no LLM).
import {
    combineRecipients,
    parsePastedRecipients,
    parseRecipientCsv,
    type IngestResult,
} from "@launchstack/features/email-pipeline/recipients";
import { createMerge } from "@launchstack/features/email-pipeline/merge";
import { SEED_TEMPLATES } from "@launchstack/features/email-pipeline/templates";
import {
    hasErrors,
    templateTokens,
    validateRecipients,
    validateRendered,
    validateTemplate,
    type ValidationIssue,
} from "@launchstack/features/email-pipeline/validators";
import type {
    EmailTemplate,
    Recipient,
    SendResult,
    TemplateReview,
} from "@launchstack/features/email-pipeline/types";

/**
 * Email outreach workspace (member.md Phase 4).
 *
 * One screen: recipients → template → review → dry-run preview → send.
 *
 * Deterministic validation runs locally on every keystroke, so a user sees a
 * bad address or an unresolved token before spending an LLM call — and a real
 * send stays behind an explicit, separate confirmation.
 *
 * Dry runs use the legacy /api/email-pipeline/send endpoint. A real send goes
 * through the staged campaign lifecycle instead:
 *   1. POST /api/email-campaigns             — create + generate + review
 *   2. (confirm) the SERVER-generated template is shown for review
 *   3. POST /api/email-campaigns/{id}/approve — clear that exact version
 *   4. POST /api/email-campaigns/{id}/send    — deliver, idempotency-keyed
 */

type Stage = "idle" | "generating" | "dry-running" | "preparing" | "sending";

const SENDER_PLACEHOLDER = "Your Company, 1 Example St, City";

/**
 * A campaign staged for real delivery: the server-side ids to approve/send,
 * the template exactly as the server generated it (which is what will be
 * delivered — not the local seed/preview), and one idempotency key per user
 * action, reused on retry so a repeat can never double-send.
 */
interface PendingSend {
    campaignId: number;
    templateVersionId: number;
    template: EmailTemplate;
    review: TemplateReview | null;
    recipientCount: number;
    /** Fingerprint of the recipient list the campaign was created with. */
    recipientsKey: string;
    idempotencyKey: string;
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
    if (issues.length === 0) return null;
    return (
        <ul className="mt-2 space-y-1 text-sm">
            {issues.map((issue, i) => (
                <li
                    key={`${issue.code}-${i}`}
                    className={
                        issue.severity === "error"
                            ? "text-red-700 dark:text-red-400"
                            : "text-amber-700 dark:text-amber-400"
                    }
                >
                    <span className="font-mono text-xs uppercase tracking-wide opacity-70">
                        {issue.severity}
                    </span>{" "}
                    {issue.message}
                </li>
            ))}
        </ul>
    );
}

function Section({
    step,
    title,
    children,
}: {
    step: number;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 flex items-baseline gap-2 text-base font-semibold">
                <span className="font-mono text-xs text-neutral-500">{step}</span>
                {title}
            </h2>
            {children}
        </section>
    );
}

export function EmailPipelineWorkspace() {
    const [pasted, setPasted] = useState("");
    const [csv, setCsv] = useState("");
    const [campaignName, setCampaignName] = useState("Outreach");
    const [goal, setGoal] = useState("");
    const [senderIdentity, setSenderIdentity] = useState("");

    const [template, setTemplate] = useState<EmailTemplate | null>(null);
    const [review, setReview] = useState<TemplateReview | null>(null);
    const [results, setResults] = useState<SendResult[] | null>(null);
    const [sentMode, setSentMode] = useState<string | null>(null);

    const [stage, setStage] = useState<Stage>("idle");
    const [error, setError] = useState<string | null>(null);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [confirmSend, setConfirmSend] = useState(false);
    const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);

    /* ── recipients: parsed and validated locally, no server round-trip ── */

    const ingest: IngestResult = useMemo(
        () => combineRecipients(parsePastedRecipients(pasted), parseRecipientCsv(csv)),
        [pasted, csv]
    );

    const requiredFields = useMemo(() => (template ? templateTokens(template) : []), [template]);

    const validation = useMemo(
        () => validateRecipients(ingest.recipients, { requiredFields }),
        [ingest.recipients, requiredFields]
    );

    const recipients: Recipient[] = validation.valid;

    const templateIssues = useMemo(() => (template ? validateTemplate(template) : []), [template]);

    /* ── preview: the exact bytes that would be delivered ── */

    const preview = useMemo(() => {
        if (!template || recipients.length === 0) return null;
        const recipient = recipients[Math.min(previewIndex, recipients.length - 1)]!;
        const unsubscribeUrl = `https://example.com/api/email-pipeline/unsubscribe/preview/${encodeURIComponent(recipient.email)}`;
        const identity = senderIdentity.trim() || SENDER_PLACEHOLDER;

        const rendered = createMerge({
            compliance: { unsubscribeUrl, senderIdentity: identity },
        })(template, recipient);

        return {
            recipient,
            rendered,
            issues: validateRendered(rendered, {
                senderIdentity: identity,
                unsubscribeUrl,
            }),
        };
    }, [template, recipients, previewIndex, senderIdentity]);

    const blocked =
        recipients.length === 0 ||
        !template ||
        hasErrors(templateIssues) ||
        (preview ? hasErrors(preview.issues) : true);

    // A staged campaign froze its audience at creation; if the recipient list
    // changes before the user confirms, drop the staged send so they re-stage
    // with the current list instead of silently mailing the old one.
    const recipientsKey = useMemo(() => recipients.map(r => r.email).join("\n"), [recipients]);
    useEffect(() => {
        setPendingSend(prev => (prev && prev.recipientsKey !== recipientsKey ? null : prev));
    }, [recipientsKey]);

    /* ── server calls ── */

    async function postJson(path: string, body: unknown, headers?: Record<string, string>) {
        const res = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
        });
        const payload = (await res.json()) as {
            success?: boolean;
            data?: unknown;
            message?: string;
        };
        if (!res.ok || !payload.success) {
            throw new Error(payload.message ?? `Request failed (${res.status})`);
        }
        return payload.data;
    }

    async function post(path: string, body: unknown) {
        return postJson(`/api/email-pipeline/${path}`, body);
    }

    async function handleGenerate() {
        setStage("generating");
        setError(null);
        setResults(null);
        try {
            const data = (await post("generate", { goal: goal.trim() || undefined })) as {
                template: EmailTemplate;
                review: TemplateReview;
            };
            setTemplate(data.template);
            setReview(data.review);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not generate a template.");
        } finally {
            setStage("idle");
        }
    }

    async function handleDryRun() {
        setStage("dry-running");
        setError(null);
        try {
            const data = (await post("send", {
                name: campaignName.trim() || "Outreach",
                goal: goal.trim() || undefined,
                recipients,
                mode: "dry_run",
            })) as { results: SendResult[]; mode: string };
            setResults(data.results);
            setSentMode(data.mode);
        } catch (e) {
            setError(e instanceof Error ? e.message : "The dry run failed.");
        } finally {
            setStage("idle");
        }
    }

    /**
     * Stage 1 of a real send: create the campaign server-side (which generates
     * and reviews template version 1) and hold its ids. Nothing is delivered
     * until the user confirms the server's template in the panel below.
     */
    async function handlePrepareSend() {
        setStage("preparing");
        setError(null);
        setResults(null);
        try {
            const data = (await postJson("/api/email-campaigns", {
                name: campaignName.trim() || "Outreach",
                goal: goal.trim() || undefined,
                recipients,
            })) as {
                campaignId: number;
                templateVersionId: number;
                template: EmailTemplate;
                review: TemplateReview | null;
            };
            setPendingSend({
                campaignId: data.campaignId,
                templateVersionId: data.templateVersionId,
                template: data.template,
                review: data.review ?? null,
                recipientCount: recipients.length,
                recipientsKey,
                // Generated once per user action; retries of the confirm step
                // reuse it so the server replays instead of re-delivering.
                idempotencyKey: crypto.randomUUID(),
            });
        } catch (e) {
            setError(
                `Creating the campaign failed: ${e instanceof Error ? e.message : "unknown error"}`
            );
        } finally {
            setStage("idle");
        }
    }

    /** Stages 2 + 3 of a real send: approve the previewed version, then deliver. */
    async function handleConfirmSend() {
        if (!pendingSend) return;
        setStage("sending");
        setError(null);
        try {
            try {
                await postJson(`/api/email-campaigns/${pendingSend.campaignId}/approve`, {
                    templateVersionId: pendingSend.templateVersionId,
                    // A non-passing review may still be sent, but only on the
                    // record — the verdict is shown in the confirm panel.
                    ...(pendingSend.review && pendingSend.review.verdict !== "pass"
                        ? {
                              overrideReason:
                                  "Confirmed from the outreach workspace despite the review verdict.",
                          }
                        : {}),
                });
            } catch (e) {
                throw new Error(
                    `Approving the template failed: ${e instanceof Error ? e.message : "unknown error"}`
                );
            }

            let data: { results: SendResult[]; mode: string };
            try {
                data = (await postJson(
                    `/api/email-campaigns/${pendingSend.campaignId}/send`,
                    { mode: "send" },
                    { "Idempotency-Key": pendingSend.idempotencyKey }
                )) as { results: SendResult[]; mode: string };
            } catch (e) {
                throw new Error(
                    `Sending failed: ${e instanceof Error ? e.message : "unknown error"}. Retrying will not double-send.`
                );
            }

            setResults(data.results);
            setSentMode(data.mode);
            setPendingSend(null);
            setConfirmSend(false);
        } catch (e) {
            // Keep pendingSend so a retry reuses the same campaign and
            // idempotency key.
            setError(e instanceof Error ? e.message : "The send failed.");
        } finally {
            setStage("idle");
        }
    }

    const busy = stage !== "idle";

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
            <header>
                <h1 className="text-xl font-semibold">Email outreach</h1>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    Every run is a dry run until you explicitly confirm a send.
                </p>
            </header>

            {error && (
                <div
                    role="alert"
                    className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                >
                    {error}
                </div>
            )}

            {/* 1 — recipients */}
            <Section step={1} title="Recipients">
                <label className="block text-sm font-medium" htmlFor="pasted">
                    Paste addresses
                </label>
                <textarea
                    id="pasted"
                    value={pasted}
                    onChange={e => setPasted(e.target.value)}
                    rows={4}
                    placeholder={"Ada Lovelace <ada@example.com>\ngrace@example.com"}
                    className="mt-1 w-full rounded-md border border-neutral-300 p-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />

                <label className="mt-4 block text-sm font-medium" htmlFor="csv">
                    Or paste a CSV (needs an <code>email</code> column)
                </label>
                <textarea
                    id="csv"
                    value={csv}
                    onChange={e => setCsv(e.target.value)}
                    rows={4}
                    placeholder={
                        "email,name,company,notes\nada@example.com,Ada,Engines,met at a conference"
                    }
                    className="mt-1 w-full rounded-md border border-neutral-300 p-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />

                <p className="mt-3 text-sm">
                    <strong>{recipients.length}</strong> ready
                    {validation.rejected.length > 0 && (
                        <span className="text-red-700 dark:text-red-400">
                            {" "}
                            · {validation.rejected.length} rejected
                        </span>
                    )}
                    {ingest.skipped.length > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                            {" "}
                            · {ingest.skipped.length} unparsed
                        </span>
                    )}
                </p>

                {ingest.skipped.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
                        {ingest.skipped.slice(0, 5).map((s, i) => (
                            <li key={i}>
                                {s.row > 0 ? `Row ${s.row}: ` : ""}
                                {s.reason} — <code>{s.raw.slice(0, 60)}</code>
                            </li>
                        ))}
                    </ul>
                )}
                {validation.rejected.slice(0, 5).map((r, i) => (
                    <div key={i} className="mt-2">
                        <code className="text-sm">{r.recipient.email}</code>
                        <IssueList issues={r.issues} />
                    </div>
                ))}
            </Section>

            {/* 2 — template */}
            <Section step={2} title="Template">
                <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                        value={campaignName}
                        onChange={e => setCampaignName(e.target.value)}
                        placeholder="Campaign name"
                        aria-label="Campaign name"
                        className="w-full rounded-md border border-neutral-300 p-2 text-sm sm:w-48 dark:border-neutral-700 dark:bg-neutral-950"
                    />
                    <input
                        value={goal}
                        onChange={e => setGoal(e.target.value)}
                        placeholder="What is this outreach for?"
                        aria-label="Campaign goal"
                        className="w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                    />
                </div>

                <input
                    value={senderIdentity}
                    onChange={e => setSenderIdentity(e.target.value)}
                    placeholder={`Sender identity — ${SENDER_PLACEHOLDER}`}
                    aria-label="Sender identity"
                    className="mt-3 w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={busy}
                        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                    >
                        {stage === "generating" ? "Generating…" : "Generate template"}
                    </button>
                    {SEED_TEMPLATES.map(seed => (
                        <button
                            key={seed.id}
                            type="button"
                            onClick={() => {
                                setTemplate(seed.template);
                                setReview(null);
                            }}
                            disabled={busy}
                            title={seed.description}
                            className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
                        >
                            Use “{seed.name}”
                        </button>
                    ))}
                </div>

                {template && (
                    <div className="mt-4">
                        <p className="text-sm">
                            <span className="text-neutral-500">Subject:</span> {template.subject}
                        </p>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-950">
                            {template.body}
                        </pre>
                        <IssueList issues={templateIssues} />
                    </div>
                )}

                {review && (
                    <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                        <p className="text-sm font-medium">
                            Review verdict:{" "}
                            <span
                                className={
                                    review.verdict === "pass"
                                        ? "text-green-700 dark:text-green-400"
                                        : "text-amber-700 dark:text-amber-400"
                                }
                            >
                                {review.verdict}
                            </span>
                        </p>
                        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                            {review.summary}
                        </p>
                        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                            {review.scores.map(s => (
                                <li key={s.criterion} className="flex justify-between gap-2">
                                    <span className="text-neutral-500">{s.criterion}</span>
                                    <span className="font-mono tabular-nums">{s.score}</span>
                                </li>
                            ))}
                        </ul>
                        {review.issues.length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
                                {review.issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                ))}
                            </ul>
                        )}
                        <p className="mt-2 text-xs text-neutral-500">
                            Scores are advisory. Nothing is blocked or rewritten on their basis —
                            you decide.
                        </p>
                    </div>
                )}
            </Section>

            {/* 3 — preview */}
            <Section step={3} title="Preview">
                {!preview ? (
                    <p className="text-sm text-neutral-500">
                        Add at least one valid recipient and a template to see the exact email.
                    </p>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            <label className="text-sm" htmlFor="preview-recipient">
                                Showing
                            </label>
                            <select
                                id="preview-recipient"
                                value={Math.min(previewIndex, recipients.length - 1)}
                                onChange={e => setPreviewIndex(Number(e.target.value))}
                                className="rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                            >
                                {recipients.map((r, i) => (
                                    <option key={r.email} value={i}>
                                        {r.email}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <p className="mt-3 text-sm">
                            <span className="text-neutral-500">Subject:</span>{" "}
                            {preview.rendered.subject}
                        </p>
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-950">
                            {preview.rendered.body}
                        </pre>
                        <IssueList issues={preview.issues} />
                    </>
                )}
            </Section>

            {/* 4 — dry run and send */}
            <Section step={4} title="Dry run and send">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleDryRun}
                        disabled={busy || blocked}
                        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                    >
                        {stage === "dry-running" ? "Running…" : `Dry run (${recipients.length})`}
                    </button>

                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={confirmSend}
                            onChange={e => setConfirmSend(e.target.checked)}
                            disabled={blocked}
                        />
                        I have read the preview and want to send for real
                    </label>

                    <button
                        type="button"
                        onClick={handlePrepareSend}
                        disabled={busy || blocked || !confirmSend || pendingSend !== null}
                        className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                        {stage === "preparing" ? "Preparing…" : `Send to ${recipients.length}`}
                    </button>
                </div>

                {blocked && (
                    <p className="mt-2 text-sm text-neutral-500">
                        Sending is disabled until there is a valid template, at least one valid
                        recipient, and a preview with no errors.
                    </p>
                )}

                {pendingSend && (
                    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                        <p className="text-sm font-medium">
                            Confirm send — this is the template the server generated and will
                            deliver (it may differ from the local preview above)
                        </p>
                        <p className="mt-2 text-sm">
                            <span className="text-neutral-500">Subject:</span>{" "}
                            {pendingSend.template.subject}
                        </p>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-sm dark:bg-neutral-950">
                            {pendingSend.template.body}
                        </pre>
                        {pendingSend.review && (
                            <p className="mt-2 text-sm">
                                Review verdict:{" "}
                                <span
                                    className={
                                        pendingSend.review.verdict === "pass"
                                            ? "text-green-700 dark:text-green-400"
                                            : "text-amber-700 dark:text-amber-400"
                                    }
                                >
                                    {pendingSend.review.verdict}
                                </span>
                                {pendingSend.review.verdict !== "pass" &&
                                    " — confirming records an override"}
                            </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={handleConfirmSend}
                                disabled={busy}
                                className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                            >
                                {stage === "sending"
                                    ? "Sending…"
                                    : `Confirm send to ${pendingSend.recipientCount}`}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPendingSend(null)}
                                disabled={busy}
                                className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {results && (
                    <div className="mt-4">
                        <p className="text-sm font-medium">
                            {sentMode === "send" ? "Sent" : "Dry run"} — {results.length} recipient
                            {results.length === 1 ? "" : "s"}
                        </p>
                        <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-sm">
                            {results.map(r => (
                                <li key={r.recipientEmail} className="flex justify-between gap-3">
                                    <code>{r.recipientEmail}</code>
                                    <span className="font-mono text-xs uppercase tracking-wide text-neutral-500">
                                        {r.status}
                                        {r.error ? ` — ${r.error}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {sentMode !== "send" && (
                            <p className="mt-2 text-xs text-neutral-500">
                                Nothing was delivered. Rows were recorded for audit only.
                            </p>
                        )}
                    </div>
                )}
            </Section>
        </div>
    );
}
