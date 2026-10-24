"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { vantageApi } from "../api";
import { CommitmentStatus } from "../_components/CheckInRow";
import { Field, FormError, StatusWord } from "../_components/Primitives";
import { addDaysIso, todayIso, useVantageFormat } from "../_lib/format";
import { vantagePath } from "../_lib/paths";

/**
 * The administrator's side of the table. Four lists, all read from what
 * the founder chose to share: requests for help, commitments that slipped,
 * program deadlines coming up, and whether the team has gone quiet. Nothing
 * private reaches this screen, by construction rather than by policy.
 *
 * settings.manage only, like its rail entry and its API. Someone without it
 * who lands here by URL is told whose screen it is (the same words the
 * Vantage tab uses). No list says "nothing here" until there is an answer to
 * say it from: skeletons while permissions or the first response are on
 * their way, and only the error when the first response failed.
 */
export function TriageScreen() {
    const t = useTranslations("vantage.triage");
    const tf = useTranslations("vantage.frame");
    const tc = useTranslations("common");
    const fmt = useVantageFormat();
    const { can, loaded, error: permissionsError, refresh } = usePermissions();
    const allowed = can("settings.manage");
    const res = useResource(allowed ? "vantage:triage" : null, () => vantageApi.triage(), {
        pollMs: 60_000,
    });
    const [adding, setAdding] = useState(false);
    const data = res.data;
    const loading = !loaded || res.loading || (allowed && data === null && res.error === null);
    const today = todayIso();

    if (loaded && !allowed) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
                <PageHeader title={t("title")} accent={t("accent")} />
                {permissionsError ? (
                    <InlineError message={permissionsError} onRetry={() => void refresh()} />
                ) : (
                    <EmptyState title={tf("deniedTitle")} body={tf("deniedBody")} />
                )}
            </div>
        );
    }

    if (res.error && !data) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
                <PageHeader title={t("title")} accent={t("accent")} />
                <InlineError message={res.error} onRetry={() => void res.reload()} />
            </div>
        );
    }

    const removeDeadline = async (id: string) => {
        try {
            await vantageApi.deleteDeadline(id);
            res.mutate(c => ({ ...c, deadlines: c.deadlines.filter(d => d.id !== id) }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("removeError"));
        }
    };

    const sub = data
        ? [
              t("sub.help", { count: data.helpRequests.length }),
              t("sub.missed", { count: data.missedCommitments.length }),
              t("sub.deadlines", { count: data.deadlines.filter(d => d.dueOn >= today).length }),
              data.lastEntryAt
                  ? t("sub.lastUpdate", { ago: fmt.ago(data.lastEntryAt) })
                  : t("sub.noUpdates"),
          ].join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={sub}
                actions={
                    can("settings.manage") ? (
                        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                            {t("addProgramDeadline")}
                        </Button>
                    ) : undefined
                }
            />

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {data && (
                <div
                    className={cn(
                        "border-line flex items-center gap-3 rounded-lg border px-4 py-3",
                        data.quiet ? "bg-panel" : "bg-panel"
                    )}
                >
                    <StatusWord tone={data.quiet ? "warn" : "success"}>
                        {data.quiet ? t("quiet") : t("active")}
                    </StatusWord>
                    <span className="text-ink-2 text-[13px]">
                        {data.lastEntryAt
                            ? t(data.quiet ? "lastEntryQuiet" : "lastEntry", {
                                  ago: fmt.ago(data.lastEntryAt),
                              })
                            : t("nothingLogged")}
                    </span>
                </div>
            )}

            <section>
                <SectionHeading title={t("helpTitle")} aside={t("helpAside")} />
                {loading ? (
                    <SkeletonRows rows={2} height={52} />
                ) : !data || data.helpRequests.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">{t("helpEmpty")}</p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {data.helpRequests.map(({ topic, weekStart }) => (
                            <div
                                key={topic.id}
                                className="border-line-2 flex flex-col gap-1 border-t px-4 py-2.5 first:border-t-0"
                            >
                                <div className="flex items-center gap-3">
                                    <ToolLink
                                        href={vantagePath(`/agenda?week=${weekStart}`)}
                                        className="text-ink hover:text-brand-ink min-w-0 flex-1 truncate text-[13px] font-medium"
                                    >
                                        {topic.title}
                                    </ToolLink>
                                    <span className="text-ink-3 shrink-0 text-[11.5px]">
                                        {fmt.weekOf(weekStart)}
                                    </span>
                                </div>
                                <p className="text-ink-2 max-w-[70ch] text-[13px]">
                                    {topic.helpRequested}
                                </p>
                                {topic.decisionQuestion && (
                                    <p className="text-ink-3 text-[12px]">
                                        {t("decisionOnTable", { question: topic.decisionQuestion })}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading title={t("missedTitle")} aside={t("sharedOnes")} />
                {loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : !data || data.missedCommitments.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">{t("missedEmpty")}</p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {data.missedCommitments.map(c => (
                            <div
                                key={c.id}
                                className="border-line-2 flex min-h-11 items-center gap-3 border-t px-4 py-2 first:border-t-0"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-ink truncate text-[13px] font-medium">
                                        {c.title}
                                    </div>
                                    <div className="text-ink-3 text-[11.5px]">
                                        {c.owner} ·{" "}
                                        {c.status === "open"
                                            ? fmt.due(c.dueOn)
                                            : t("wasDue", { date: fmt.date(c.dueOn) })}
                                        {c.outcome ? ` · ${c.outcome}` : ""}
                                    </div>
                                </div>
                                <CommitmentStatus commitment={c} />
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {data && data.dueSoon.length > 0 && (
                <section>
                    <SectionHeading title={t("dueSoonTitle")} aside={t("sharedOnes")} />
                    <div className="border-line bg-panel rounded-lg border">
                        {data.dueSoon.map(c => (
                            <div
                                key={c.id}
                                className="border-line-2 flex min-h-10 items-center gap-3 border-t px-4 py-2 first:border-t-0"
                            >
                                <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                    {c.title}
                                </span>
                                <span className="text-ink-3 text-[11.5px]">{c.owner}</span>
                                <span className="text-ink-3 font-mono text-[11.5px] tabular-nums">
                                    {c.dueOn}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <SectionHeading title={t("deadlinesTitle")} />
                {loading ? (
                    <SkeletonRows rows={2} height={40} />
                ) : !data || data.deadlines.length === 0 ? (
                    <EmptyState
                        title={t("deadlinesEmptyTitle")}
                        body={t("deadlinesEmptyBody")}
                        action={
                            can("settings.manage") ? (
                                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                                    {t("addDeadline")}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {data.deadlines.map(d => (
                            <div
                                key={d.id}
                                className="border-line-2 flex min-h-10 items-center gap-3 border-t px-4 py-2 first:border-t-0"
                            >
                                <span className="text-ink min-w-0 flex-1 truncate text-[13px] font-medium">
                                    {d.title}
                                </span>
                                {d.note && (
                                    <span className="text-ink-3 @max-sm:hidden inline max-w-[260px] truncate text-[12px]">
                                        {d.note}
                                    </span>
                                )}
                                <span
                                    className={cn(
                                        "shrink-0 text-[12px]",
                                        d.dueOn < today ? "text-ink-3" : "text-ink-2"
                                    )}
                                >
                                    {d.dueOn < today
                                        ? t("passed", { date: fmt.date(d.dueOn) })
                                        : fmt.due(d.dueOn)}
                                </span>
                                {can("settings.manage") && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-[12px]"
                                        onClick={() => void removeDeadline(d.id)}
                                    >
                                        {tc("actions.remove")}
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <DeadlineDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={() => void res.reload()}
            />
        </div>
    );
}

function DeadlineDialog({
    open,
    onOpenChange,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSaved: () => void;
}) {
    const t = useTranslations("vantage.triage");
    const tc = useTranslations("common");
    const [title, setTitle] = useState("");
    const [dueOn, setDueOn] = useState(addDaysIso(todayIso(), 14));
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setTitle("");
        setNote("");
        setDueOn(addDaysIso(todayIso(), 14));
        setError(null);
    }, [open]);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await vantageApi.addDeadline({ title, dueOn, note: note || null });
            toast(t("deadlineAdded"));
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{t("addProgramDeadline")}</DialogTitle>
                    <DialogDescription>{t("deadlineDescription")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label={t("what")} htmlFor="dl-title">
                        <Input
                            id="dl-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder={t("whatPlaceholder")}
                        />
                    </Field>
                    <Field label={t("when")} htmlFor="dl-due">
                        <Input
                            id="dl-due"
                            type="date"
                            value={dueOn}
                            onChange={e => setDueOn(e.target.value)}
                        />
                    </Field>
                    <Field label={t("note")} htmlFor="dl-note">
                        <Input
                            id="dl-note"
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder={tc("status.optional")}
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button onClick={() => void save()} disabled={busy || !title.trim() || !dueOn}>
                        {tc("actions.add")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
