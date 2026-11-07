"use client";

/**
 * One report. The same screen in all three places, showing what the reader
 * may see:
 *
 * - the reporter: what they sent (screenshots, what was attached), its
 *   status, and a thread with the team where they can add more;
 * - anyone else, for a feature request on the board: the request, its votes
 *   and the team's answers — not who asked, nor their page or screenshots;
 * - a triager: all of it, plus who filed it from which workspace, status and
 *   severity controls, and "Copy as GitHub issue".
 *
 * The server decides what is in the answer; this screen only draws it.
 */

import React, { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { KindIcon, SeverityBadge, StatusBadge } from "~/components/feedback/labels";
import { VoteButton } from "~/components/feedback/VoteButton";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { useToolNav } from "~/components/tool-app/nav";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { copyText } from "~/lib/context-menu";
import {
    FeedbackApiError,
    getFeedback,
    onFeedbackChanged,
    replyToFeedback,
    updateFeedback,
} from "~/lib/feedback/api";
import {
    BUG_SEVERITIES,
    FEEDBACK_LIMITS,
    FEEDBACK_STATUSES,
    type BugSeverity,
    type FeedbackDetail,
    type FeedbackScreen,
    type FeedbackStatus,
} from "~/lib/feedback/contract";
import { feedbackIssueMarkdown, feedbackIssueTitle } from "~/lib/feedback/github-markdown";

import { BackButton, ErrorLine } from "../team/ui";
import { feedbackPaths } from "./screens";

const NO_SEVERITY = "none";

export function FeedbackReport({ screen, id }: { screen: FeedbackScreen; id: number }) {
    const t = useTranslations("feedback.report");
    const tNav = useTranslations("feedback.tool.nav");
    const { navigate } = useToolNav();
    const [report, setReport] = useState<FeedbackDetail | null>(null);
    const [missing, setMissing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setError(null);
        getFeedback(id, controller.signal)
            .then(next => {
                setReport(next);
                setMissing(false);
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                if (err instanceof FeedbackApiError && err.status === 404) setMissing(true);
                else
                    setError(
                        err instanceof FeedbackApiError && err.message
                            ? err.message
                            : t("loadFailed")
                    );
            });
        return () => controller.abort();
    }, [id, reloadKey, t]);

    useEffect(() => onFeedbackChanged(() => setReloadKey(k => k + 1)), []);

    const back = (
        <BackButton label={tNav(screen)} onClick={() => navigate(feedbackPaths.list(screen))} />
    );

    if (missing) {
        return (
            <ToolNotFound
                home={feedbackPaths.list(screen)}
                homeLabel={tNav(screen)}
                title={t("goneTitle")}
                body={t("goneBody")}
            />
        );
    }
    if (!report) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
                <div>{back}</div>
                {error ? (
                    <ErrorLine flush message={error} onRetry={() => setReloadKey(k => k + 1)} />
                ) : (
                    <SkeletonBlock lines={4} className="max-w-xl" />
                )}
            </div>
        );
    }

    return (
        <div
            className="@max-lg:grid-cols-1 mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)_290px] items-start gap-6"
            data-testid="feedback-report"
            data-report-id={report.id}
        >
            <div className="flex min-w-0 flex-col gap-5">
                <div>{back}</div>
                <header className="flex min-w-0 items-start gap-3">
                    {report.kind === "idea" ? (
                        <VoteButton
                            id={report.id}
                            votes={report.votes}
                            voted={report.voted}
                            size="lg"
                        />
                    ) : (
                        <span className="bg-panel-2 mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md">
                            <KindIcon kind={report.kind} className="size-5" />
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <h1 className="display text-ink m-0 text-balance text-[24px] leading-[1.15] tracking-[-0.01em]">
                            {report.title}
                        </h1>
                        <div className="text-ink-3 mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                            <span className="tabular-nums">#{report.id}</span>
                            <StatusBadge status={report.status} />
                            {report.severity && <SeverityBadge severity={report.severity} />}
                            {report.mine && <Badge variant="secondary">{t("yours")}</Badge>}
                        </div>
                    </div>
                </header>

                {report.body ? (
                    <p className="text-ink-2 m-0 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                        {report.body}
                    </p>
                ) : (
                    <p className="text-ink-3 m-0 text-[13px] italic">{t("noBody")}</p>
                )}

                {report.attachmentList && report.attachmentList.length > 0 && (
                    <ul
                        className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-0"
                        data-testid="feedback-attachments"
                    >
                        {report.attachmentList.map((a, i) => (
                            <li key={a.id}>
                                <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="border-line bg-panel-2 hover:border-brand block overflow-hidden rounded-md border"
                                    title={t("openImage")}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated, same-origin */}
                                    <img
                                        src={a.url}
                                        alt={t("imageAlt", { n: i + 1 })}
                                        className="aspect-video w-full object-cover object-top"
                                        loading="lazy"
                                    />
                                </a>
                            </li>
                        ))}
                    </ul>
                )}

                <Thread report={report} onReplied={() => setReloadKey(k => k + 1)} />
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
                {report.canTriage ? <TriageControls report={report} onChanged={setReport} /> : null}
                <Facts report={report} />
            </aside>
        </div>
    );
}

function Thread({ report, onReplied }: { report: FeedbackDetail; onReplied: () => void }) {
    const t = useTranslations("feedback.report");
    const format = useFormatter();
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const send = async () => {
        const body = text.trim();
        if (!body || busy) return;
        setBusy(true);
        setError(null);
        try {
            await replyToFeedback(report.id, body);
            setText("");
            onReplied();
        } catch (err) {
            setError(
                err instanceof FeedbackApiError && err.status === 429
                    ? t("rateLimited")
                    : err instanceof FeedbackApiError && err.message
                      ? err.message
                      : t("replyFailed")
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="flex flex-col gap-3" data-testid="feedback-thread">
            <h2 className="text-ink-3 m-0 text-[11px] font-semibold uppercase tracking-[0.04em]">
                {t("threadTitle")}
            </h2>
            {report.thread.length === 0 ? (
                <p className="text-ink-3 m-0 text-[13px]">
                    {report.canTriage ? t("threadEmptyTriage") : t("threadEmpty")}
                </p>
            ) : (
                <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {report.thread.map(reply => (
                        <li
                            key={reply.id}
                            className={
                                reply.fromTeam
                                    ? "border-brand/30 bg-brand-soft/40 rounded-lg border px-3.5 py-2.5"
                                    : "border-line bg-panel rounded-lg border px-3.5 py-2.5"
                            }
                            data-testid="feedback-reply"
                            data-from-team={reply.fromTeam ? "true" : "false"}
                        >
                            <div className="text-ink-3 mb-1 flex flex-wrap items-center gap-2 text-[12px]">
                                <span className="text-ink font-medium">
                                    {reply.mine
                                        ? t("you")
                                        : reply.author.name ||
                                          (reply.fromTeam ? t("team") : t("requester"))}
                                </span>
                                {reply.fromTeam && <Badge variant="info">{t("team")}</Badge>}
                                <span>
                                    {format.relativeTime(new Date(reply.createdAt), new Date())}
                                </span>
                            </div>
                            <p className="text-ink-2 m-0 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                                {reply.body}
                            </p>
                        </li>
                    ))}
                </ol>
            )}
            {report.canReply && (
                <form
                    className="flex flex-col gap-2"
                    onSubmit={event => {
                        event.preventDefault();
                        void send();
                    }}
                >
                    <Textarea
                        value={text}
                        onChange={event => setText(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                void send();
                            }
                        }}
                        rows={3}
                        maxLength={FEEDBACK_LIMITS.replyMax}
                        placeholder={
                            report.canTriage ? t("replyPlaceholderTeam") : t("replyPlaceholder")
                        }
                        aria-label={t("replyLabel")}
                        data-testid="feedback-reply-input"
                    />
                    {error && (
                        <p role="alert" className="text-danger m-0 text-xs">
                            {error}
                        </p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-ink-3 text-xs">
                            {report.canTriage ? t("replyHintTeam") : t("replyHint")}
                        </span>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={!text.trim() || busy}
                            data-testid="feedback-reply-send"
                        >
                            {busy ? (
                                <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                                <Send aria-hidden />
                            )}
                            {t("send")}
                        </Button>
                    </div>
                </form>
            )}
        </section>
    );
}

function TriageControls({
    report,
    onChanged,
}: {
    report: FeedbackDetail;
    onChanged: (report: FeedbackDetail) => void;
}) {
    const t = useTranslations("feedback.report");
    const ts = useTranslations("feedback.status");
    const tsev = useTranslations("feedback.severity");
    const [busy, setBusy] = useState(false);

    const change = async (patch: { status?: FeedbackStatus; severity?: BugSeverity | null }) => {
        setBusy(true);
        try {
            onChanged(await updateFeedback(report.id, patch));
            toast.success(t("updated"));
        } catch (err) {
            toast.error(
                err instanceof FeedbackApiError && err.message ? err.message : t("updateFailed")
            );
        } finally {
            setBusy(false);
        }
    };

    const copyIssue = async () => {
        const text = `${feedbackIssueTitle(report)}\n\n${feedbackIssueMarkdown(report)}`;
        if (await copyText(text)) toast.success(t("issueCopied"));
    };

    return (
        <section
            className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-3.5"
            data-testid="feedback-triage-controls"
        >
            <label className="flex flex-col gap-1.5">
                <span className="text-ink-3 text-[11px] font-semibold uppercase tracking-[0.04em]">
                    {t("status")}
                </span>
                <Select
                    value={report.status}
                    onValueChange={value => void change({ status: value as FeedbackStatus })}
                    disabled={busy}
                >
                    <SelectTrigger
                        className="h-8 w-full text-[13px]"
                        data-testid="feedback-status-select"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {FEEDBACK_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>
                                {ts(s)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </label>
            {report.kind === "bug" && (
                <label className="flex flex-col gap-1.5">
                    <span className="text-ink-3 text-[11px] font-semibold uppercase tracking-[0.04em]">
                        {t("severity")}
                    </span>
                    <Select
                        value={report.severity ?? NO_SEVERITY}
                        onValueChange={value =>
                            void change({
                                severity: value === NO_SEVERITY ? null : (value as BugSeverity),
                            })
                        }
                        disabled={busy}
                    >
                        <SelectTrigger
                            className="h-8 w-full text-[13px]"
                            data-testid="feedback-severity-select"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_SEVERITY}>{t("noSeverity")}</SelectItem>
                            {BUG_SEVERITIES.map(s => (
                                <SelectItem key={s} value={s}>
                                    {tsev(s)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
            )}
            <p className="text-ink-3 m-0 text-[11.5px] leading-normal">{t("statusHint")}</p>
            <Button
                variant="outline"
                size="sm"
                onClick={() => void copyIssue()}
                data-testid="feedback-copy-issue"
            >
                <Copy aria-hidden />
                {t("copyIssue")}
            </Button>
        </section>
    );
}

/** Who, where, when, and what came with it. */
function Facts({ report }: { report: FeedbackDetail }) {
    const t = useTranslations("feedback.report");
    const tc = useTranslations("feedback.dialog.context");
    const format = useFormatter();
    const context = report.context;
    const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [];
    rows.push({
        label: t("filed"),
        value: format.dateTime(new Date(report.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
        }),
    });
    if (report.reporter)
        rows.push({
            label: t("reporter"),
            value: report.reporter.email
                ? `${report.reporter.name} <${report.reporter.email}>`
                : report.reporter.name,
        });
    if (report.workspaceName) rows.push({ label: t("workspace"), value: report.workspaceName });
    if (report.kind === "idea") rows.push({ label: t("votesLabel"), value: String(report.votes) });
    if (context?.path)
        rows.push({
            label: tc("page"),
            mono: true,
            value: context.url ? (
                <a
                    href={context.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-ink inline-flex max-w-full items-center gap-1 hover:underline"
                >
                    <span className="truncate">{context.path}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
            ) : (
                context.path
            ),
        });
    if (context?.appVersion)
        rows.push({ label: t("version"), value: context.appVersion, mono: true });
    if (context?.browser) rows.push({ label: tc("browser"), value: context.browser });
    if (context?.viewport)
        rows.push({
            label: tc("window"),
            value: `${context.viewport.width} × ${context.viewport.height}`,
        });
    if (context?.screen)
        rows.push({
            label: tc("screen"),
            value: `${context.screen.width} × ${context.screen.height} @${context.screen.pixelRatio}x`,
        });
    if (context?.theme) rows.push({ label: tc("theme"), value: tc(`themes.${context.theme}`) });
    if (context?.locale) rows.push({ label: tc("language"), value: context.locale });
    if (context?.timeZone) rows.push({ label: tc("timeZone"), value: context.timeZone });
    for (const [key, value] of Object.entries(context?.origin ?? {}))
        rows.push({ label: key, value, mono: true });

    const errors = context?.recentErrors ?? [];
    return (
        <section
            className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-3.5"
            data-testid="feedback-facts"
        >
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                {rows.map(row => (
                    <React.Fragment key={row.label}>
                        <dt className="text-ink-3">{row.label}</dt>
                        <dd
                            className={
                                row.mono
                                    ? "text-ink-2 mono m-0 min-w-0 break-words text-[11.5px]"
                                    : "text-ink-2 m-0 min-w-0 break-words"
                            }
                        >
                            {row.value}
                        </dd>
                    </React.Fragment>
                ))}
            </dl>
            {errors.length > 0 && (
                <div>
                    <div className="text-ink-3 mb-1 text-[12px]">{tc("recentErrors")}</div>
                    <ol
                        className="bg-panel-2 m-0 flex max-h-48 list-none flex-col gap-1.5 overflow-y-auto rounded p-2"
                        data-testid="feedback-errors"
                    >
                        {errors.map((e, i) => (
                            <li
                                key={i}
                                className="mono text-ink-2 break-words text-[11px] leading-snug"
                            >
                                {e.message}
                            </li>
                        ))}
                    </ol>
                </div>
            )}
            {!context && !report.mine && report.kind === "idea" && (
                <p className="text-ink-3 m-0 text-[11.5px] leading-normal">{t("privateNote")}</p>
            )}
        </section>
    );
}
