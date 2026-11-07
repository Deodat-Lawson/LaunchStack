"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

// Import from submodules, never the package barrel: the barrel re-exports
// db.ts / generator.ts, which pull `getDb` and the LLM client into the client
// bundle. Everything imported here is pure (no DB, no network, no LLM).
import {
    combineRecipients,
    parsePastedRecipients,
    parseRecipientCsv,
    type IngestResult,
} from "@launchstack/pipelines/email/recipients";
import { createMerge } from "@launchstack/pipelines/email/merge";
import { SEED_TEMPLATES } from "@launchstack/pipelines/email/templates";
import {
    hasErrors,
    templateTokens,
    validateRecipients,
    validateRendered,
    validateTemplate,
    type ValidationIssue,
} from "@launchstack/pipelines/email/validators";
import type {
    EmailTemplate,
    Recipient,
    SendResult,
    TemplateReview,
} from "@launchstack/pipelines/email/types";

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

type EmailT = ReturnType<typeof useTranslations<"growth.emailPipeline">>;

/** A seed template's name and description, by its id; the template itself stays as written. */
const SEED_KEY: Record<string, "intro" | "followUp"> = { intro: "intro", "follow-up": "followUp" };

const CRITERION_KEY: Record<
    string,
    "grounding" | "clarity" | "tone" | "spamRisk" | "ctaStrength" | "compliance"
> = {
    grounding: "grounding",
    clarity: "clarity",
    tone: "tone",
    spam_risk: "spamRisk",
    cta_strength: "ctaStrength",
    compliance: "compliance",
};

const STATUS_KEY: Record<
    string,
    "queued" | "dryRun" | "sent" | "failed" | "suppressed" | "skipped"
> = {
    queued: "queued",
    dry_run: "dryRun",
    sent: "sent",
    failed: "failed",
    suppressed: "suppressed",
    skipped: "skipped",
};

/** A review criterion's word; one the catalogue does not know shows as it came. */
function criterionWord(t: EmailT, criterion: string): string {
    const key = CRITERION_KEY[criterion];
    return key ? t(`template.criteria.${key}`) : criterion;
}

/** A delivery status's word; one the catalogue does not know shows as it came. */
function statusWord(t: EmailT, status: string): string {
    const key = STATUS_KEY[status];
    return key ? t(`send.statuses.${key}`) : status;
}

function verdictWord(t: EmailT, verdict: string): string {
    return verdict === "pass" || verdict === "revise" ? t(`template.verdicts.${verdict}`) : verdict;
}

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
    const t = useTranslations("growth.emailPipeline");
    if (issues.length === 0) return null;
    return (
        <ul className="mt-2 space-y-1 text-sm">
            {issues.map((issue, i) => (
                <li
                    key={`${issue.code}-${i}`}
                    className={issue.severity === "error" ? "text-danger-ink" : "text-warn-ink"}
                >
                    <span className="text-xs font-semibold uppercase tracking-wide">
                        {issue.severity === "error" ? t("severity.error") : t("severity.warning")}
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
        <section className="border-line bg-panel text-ink rounded-lg border p-5">
            <h2 className="mb-3 flex items-baseline gap-2 text-base font-semibold">
                <span className="text-ink-3 text-xs tabular-nums">{step}</span>
                {title}
            </h2>
            {children}
        </section>
    );
}

export function EmailPipelineWorkspace() {
    const t = useTranslations("growth.emailPipeline");
    const tc = useTranslations("common.actions");
    const defaultName = t("template.defaultName");
    const senderExample = t("template.senderExample");
    const [pasted, setPasted] = useState("");
    const [csv, setCsv] = useState("");
    const [campaignName, setCampaignName] = useState(defaultName);
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
        const identity = senderIdentity.trim() || senderExample;

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
    }, [template, recipients, previewIndex, senderIdentity, senderExample]);

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
            throw new Error(payload.message ?? t("errors.requestFailed", { status: res.status }));
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
            setError(e instanceof Error ? e.message : t("errors.generateFailed"));
        } finally {
            setStage("idle");
        }
    }

    async function handleDryRun() {
        setStage("dry-running");
        setError(null);
        try {
            const data = (await post("send", {
                name: campaignName.trim() || defaultName,
                goal: goal.trim() || undefined,
                recipients,
                mode: "dry_run",
            })) as { results: SendResult[]; mode: string };
            setResults(data.results);
            setSentMode(data.mode);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("errors.dryRunFailed"));
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
                name: campaignName.trim() || defaultName,
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
                t("errors.createFailed", {
                    error: e instanceof Error ? e.message : t("errors.unknown"),
                })
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
                    t("errors.approveFailed", {
                        error: e instanceof Error ? e.message : t("errors.unknown"),
                    })
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
                    t("errors.sendFailed", {
                        error: e instanceof Error ? e.message : t("errors.unknown"),
                    })
                );
            }

            setResults(data.results);
            setSentMode(data.mode);
            setPendingSend(null);
            setConfirmSend(false);
        } catch (e) {
            // Keep pendingSend so a retry reuses the same campaign and
            // idempotency key.
            setError(e instanceof Error ? e.message : t("errors.sendFailedGeneric"));
        } finally {
            setStage("idle");
        }
    }

    const busy = stage !== "idle";

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
            <header>
                <h1 className="text-xl font-semibold">{t("title")}</h1>
                <p className="text-ink-2 mt-1 text-sm">{t("subtitle")}</p>
            </header>

            {error && (
                <div
                    role="alert"
                    className="border-danger/40 bg-danger-soft text-danger-ink rounded-md border p-3 text-sm"
                >
                    {error}
                </div>
            )}

            {/* 1 — recipients */}
            <Section step={1} title={t("recipients.title")}>
                <Label htmlFor="pasted">{t("recipients.paste")}</Label>
                <Textarea
                    id="pasted"
                    value={pasted}
                    onChange={e => setPasted(e.target.value)}
                    rows={4}
                    placeholder={"Ada Lovelace <ada@example.com>\ngrace@example.com"}
                    className="mt-2 min-h-24 font-mono"
                />

                <Label className="mt-4 block leading-normal" htmlFor="csv">
                    {t.rich("recipients.csv", {
                        code: chunks => <code>{chunks}</code>,
                    })}
                </Label>
                <Textarea
                    id="csv"
                    value={csv}
                    onChange={e => setCsv(e.target.value)}
                    rows={4}
                    placeholder={
                        "email,name,company,notes\nada@example.com,Ada,Engines,met at a conference"
                    }
                    className="mt-2 min-h-24 font-mono"
                />

                <p className="mt-3 text-sm">
                    {t.rich("recipients.ready", {
                        count: recipients.length,
                        strong: chunks => <strong>{chunks}</strong>,
                    })}
                    {validation.rejected.length > 0 && (
                        <span className="text-danger-ink">
                            {" "}
                            {t("recipients.rejected", { count: validation.rejected.length })}
                        </span>
                    )}
                    {ingest.skipped.length > 0 && (
                        <span className="text-warn-ink">
                            {" "}
                            {t("recipients.unparsed", { count: ingest.skipped.length })}
                        </span>
                    )}
                </p>

                {ingest.skipped.length > 0 && (
                    <ul className="text-warn-ink mt-2 space-y-1 text-sm">
                        {ingest.skipped.slice(0, 5).map((s, i) => (
                            <li key={i}>
                                {s.row > 0
                                    ? t("recipients.rowReason", { row: s.row, reason: s.reason })
                                    : s.reason}{" "}
                                — <code>{s.raw.slice(0, 60)}</code>
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
            <Section step={2} title={t("template.title")}>
                <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                        value={campaignName}
                        onChange={e => setCampaignName(e.target.value)}
                        placeholder={t("template.campaignName")}
                        aria-label={t("template.campaignName")}
                        className="sm:w-48 sm:shrink-0"
                    />
                    <Input
                        value={goal}
                        onChange={e => setGoal(e.target.value)}
                        placeholder={t("template.goalPlaceholder")}
                        aria-label={t("template.goalAria")}
                    />
                </div>

                <Input
                    value={senderIdentity}
                    onChange={e => setSenderIdentity(e.target.value)}
                    placeholder={t("template.senderPlaceholder", { example: senderExample })}
                    aria-label={t("template.senderAria")}
                    className="mt-3"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={handleGenerate} disabled={busy}>
                        {stage === "generating" ? t("template.generating") : t("template.generate")}
                    </Button>
                    {SEED_TEMPLATES.map(seed => {
                        const key = SEED_KEY[seed.id];
                        const name = key ? t(`template.seeds.${key}.name`) : seed.name;
                        const description = key
                            ? t(`template.seeds.${key}.description`)
                            : seed.description;
                        return (
                            <Button
                                key={seed.id}
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setTemplate(seed.template);
                                    setReview(null);
                                }}
                                disabled={busy}
                                title={description}
                            >
                                {t("template.useSeed", { name })}
                            </Button>
                        );
                    })}
                </div>

                {template && (
                    <div className="mt-4">
                        <p className="text-sm">
                            <span className="text-ink-3">{t("template.subject")}</span>{" "}
                            {template.subject}
                        </p>
                        <pre className="bg-surface-sunk text-ink mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md p-3 text-sm">
                            {template.body}
                        </pre>
                        <IssueList issues={templateIssues} />
                    </div>
                )}

                {review && (
                    <div className="border-line mt-4 border-t pt-3">
                        <p className="text-sm font-medium">
                            {t("template.verdictLabel")}{" "}
                            <span
                                className={
                                    review.verdict === "pass" ? "text-success-ink" : "text-warn-ink"
                                }
                            >
                                {verdictWord(t, review.verdict)}
                            </span>
                        </p>
                        <p className="text-ink-2 mt-1 text-sm">{review.summary}</p>
                        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                            {review.scores.map(s => (
                                <li key={s.criterion} className="flex justify-between gap-2">
                                    <span className="text-ink-3">
                                        {criterionWord(t, s.criterion)}
                                    </span>
                                    <span className="font-mono tabular-nums">{s.score}</span>
                                </li>
                            ))}
                        </ul>
                        {review.issues.length > 0 && (
                            <ul className="text-warn-ink mt-2 list-disc space-y-1 pl-5 text-sm">
                                {review.issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                ))}
                            </ul>
                        )}
                        <p className="text-ink-3 mt-2 text-xs">{t("template.advisory")}</p>
                    </div>
                )}
            </Section>

            {/* 3 — preview */}
            <Section step={3} title={t("preview.title")}>
                {!preview ? (
                    <p className="text-ink-3 text-sm">{t("preview.empty")}</p>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            <Label className="font-normal" htmlFor="preview-recipient">
                                {t("preview.showing")}
                            </Label>
                            <Select
                                value={String(Math.min(previewIndex, recipients.length - 1))}
                                onValueChange={v => setPreviewIndex(Number(v))}
                            >
                                <SelectTrigger
                                    id="preview-recipient"
                                    size="sm"
                                    className="w-auto max-w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {recipients.map((r, i) => (
                                        <SelectItem key={r.email} value={String(i)}>
                                            {r.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="mt-3 text-sm">
                            <span className="text-ink-3">{t("template.subject")}</span>{" "}
                            {preview.rendered.subject}
                        </p>
                        <pre className="bg-surface-sunk text-ink mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md p-3 text-sm">
                            {preview.rendered.body}
                        </pre>
                        <IssueList issues={preview.issues} />
                    </>
                )}
            </Section>

            {/* 4 — dry run and send */}
            <Section step={4} title={t("send.title")}>
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" onClick={handleDryRun} disabled={busy || blocked}>
                        {stage === "dry-running"
                            ? t("send.running")
                            : t("send.dryRun", { count: recipients.length })}
                    </Button>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="confirm-send"
                            checked={confirmSend}
                            onCheckedChange={checked => setConfirmSend(checked === true)}
                            disabled={blocked}
                        />
                        <Label className="font-normal" htmlFor="confirm-send">
                            {t("send.confirmCheckbox")}
                        </Label>
                    </div>

                    <Button
                        type="button"
                        variant="destructive"
                        onClick={handlePrepareSend}
                        disabled={busy || blocked || !confirmSend || pendingSend !== null}
                    >
                        {stage === "preparing"
                            ? t("send.preparing")
                            : t("send.sendTo", { count: recipients.length })}
                    </Button>
                </div>

                {blocked && <p className="text-ink-3 mt-2 text-sm">{t("send.blocked")}</p>}

                {pendingSend && (
                    <div className="border-warn/40 bg-warn-soft text-ink mt-4 rounded-md border p-4">
                        <p className="text-sm font-medium">{t("send.confirmTitle")}</p>
                        <p className="mt-2 text-sm">
                            <span className="text-ink-2">{t("template.subject")}</span>{" "}
                            {pendingSend.template.subject}
                        </p>
                        <pre className="bg-panel text-ink mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md p-3 text-sm">
                            {pendingSend.template.body}
                        </pre>
                        {pendingSend.review && (
                            <p className="mt-2 text-sm">
                                {t("template.verdictLabel")}{" "}
                                <span
                                    className={
                                        pendingSend.review.verdict === "pass"
                                            ? "text-success-ink"
                                            : "text-warn-ink"
                                    }
                                >
                                    {verdictWord(t, pendingSend.review.verdict)}
                                </span>
                                {pendingSend.review.verdict !== "pass" && t("send.override")}
                            </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={handleConfirmSend}
                                disabled={busy}
                            >
                                {stage === "sending"
                                    ? t("send.sending")
                                    : t("send.confirmSendTo", {
                                          count: pendingSend.recipientCount,
                                      })}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setPendingSend(null)}
                                disabled={busy}
                            >
                                {tc("cancel")}
                            </Button>
                        </div>
                    </div>
                )}

                {results && (
                    <div className="mt-4">
                        <p className="text-sm font-medium">
                            {sentMode === "send"
                                ? t("send.resultsSent", { count: results.length })
                                : t("send.resultsDry", { count: results.length })}
                        </p>
                        <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-sm">
                            {results.map(r => (
                                <li key={r.recipientEmail} className="flex justify-between gap-3">
                                    <code>{r.recipientEmail}</code>
                                    <span className="text-ink-3 text-xs uppercase tracking-wide">
                                        {statusWord(t, r.status)}
                                        {r.error ? ` — ${r.error}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {sentMode !== "send" && (
                            <p className="text-ink-3 mt-2 text-xs">{t("send.nothingDelivered")}</p>
                        )}
                    </div>
                )}
            </Section>
        </div>
    );
}
