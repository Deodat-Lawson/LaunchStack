"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, InlineError } from "~/components/tool-kit/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tool-kit/PageHeader";
import { SkeletonRows } from "~/components/tool-kit/SkeletonRows";
import { useResource } from "~/components/tool-kit/useResource";
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
import {
    addDaysIso,
    agoWords,
    dueWords,
    fmtDate,
    plural,
    todayIso,
    weekLabel,
} from "../_lib/format";
import { vantagePath } from "../_lib/paths";

/**
 * The administrator's side of the table. Four lists, all read from what
 * the founder chose to share: requests for help, commitments that slipped,
 * program deadlines coming up, and whether the team has gone quiet. Nothing
 * private reaches this screen, by construction rather than by policy.
 */
export function TriageScreen() {
    const res = useResource("vantage:triage", () => vantageApi.triage(), { pollMs: 60_000 });
    const { can } = usePermissions();
    const [adding, setAdding] = useState(false);
    const data = res.data;
    const today = todayIso();

    const removeDeadline = async (id: string) => {
        try {
            await vantageApi.deleteDeadline(id);
            res.mutate(c => ({ ...c, deadlines: c.deadlines.filter(d => d.id !== id) }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not remove it");
        }
    };

    const sub = data
        ? [
              plural(data.helpRequests.length, "request for help", "requests for help"),
              plural(data.missedCommitments.length, "missed commitment"),
              plural(data.deadlines.filter(d => d.dueOn >= today).length, "deadline") + " ahead",
              data.lastEntryAt ? `last update ${agoWords(data.lastEntryAt)}` : "no updates yet",
          ].join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Where the team"
                accent="needs a hand"
                sub={sub}
                actions={
                    can("settings.manage") ? (
                        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                            Add a program deadline
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
                        {data.quiet ? "Quiet" : "Active"}
                    </StatusWord>
                    <span className="text-ink-2 text-[13px]">
                        {data.lastEntryAt
                            ? `Last entry ${agoWords(data.lastEntryAt)}${data.quiet ? " — more than a week without an update is worth a message." : "."}`
                            : "This team has not logged anything yet."}
                    </span>
                </div>
            )}

            <section>
                <SectionHeading title="Requests for help" aside="from shared topics" />
                {res.loading ? (
                    <SkeletonRows rows={2} height={52} />
                ) : !data || data.helpRequests.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">
                        No open requests. A founder can ask for help on any agenda topic they share.
                    </p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {data.helpRequests.map(({ topic, weekStart }) => (
                            <div
                                key={topic.id}
                                className="border-line-2 flex flex-col gap-1 border-t px-4 py-2.5 first:border-t-0"
                            >
                                <div className="flex items-center gap-3">
                                    <Link
                                        href={vantagePath(`/agenda?week=${weekStart}`)}
                                        className="text-ink hover:text-brand-ink min-w-0 flex-1 truncate text-[13px] font-medium"
                                    >
                                        {topic.title}
                                    </Link>
                                    <span className="text-ink-3 shrink-0 text-[11.5px]">
                                        {weekLabel(weekStart)}
                                    </span>
                                </div>
                                <p className="text-ink-2 max-w-[70ch] text-[13px]">
                                    {topic.helpRequested}
                                </p>
                                {topic.decisionQuestion && (
                                    <p className="text-ink-3 text-[12px]">
                                        Decision on the table: {topic.decisionQuestion}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading title="Missed commitments" aside="shared ones" />
                {res.loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : !data || data.missedCommitments.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">Nothing shared has slipped.</p>
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
                                            ? dueWords(c.dueOn)
                                            : `was due ${fmtDate(c.dueOn)}`}
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
                    <SectionHeading title="Due in the next two weeks" aside="shared ones" />
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
                <SectionHeading title="Program deadlines" />
                {res.loading ? (
                    <SkeletonRows rows={2} height={40} />
                ) : !data || data.deadlines.length === 0 ? (
                    <EmptyState
                        title="No program deadlines"
                        body="Demo day, an application window, a report due — put them here and every founder sees them on the agenda week they fall in."
                        action={
                            can("settings.manage") ? (
                                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                                    Add a deadline
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
                                    <span className="text-ink-3 hidden max-w-[260px] truncate text-[12px] sm:inline">
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
                                        ? `passed ${fmtDate(d.dueOn)}`
                                        : dueWords(d.dueOn)}
                                </span>
                                {can("settings.manage") && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-[12px]"
                                        onClick={() => void removeDeadline(d.id)}
                                    >
                                        Remove
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
            toast("Deadline added");
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Add a program deadline</DialogTitle>
                    <DialogDescription>Every team sees it in the week it falls.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label="What" htmlFor="dl-title">
                        <Input
                            id="dl-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder="Demo day rehearsal"
                        />
                    </Field>
                    <Field label="When" htmlFor="dl-due">
                        <Input
                            id="dl-due"
                            type="date"
                            value={dueOn}
                            onChange={e => setDueOn(e.target.value)}
                        />
                    </Field>
                    <Field label="Note" htmlFor="dl-note">
                        <Input
                            id="dl-note"
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="Optional"
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={busy || !title.trim() || !dueOn}>
                        Add
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
