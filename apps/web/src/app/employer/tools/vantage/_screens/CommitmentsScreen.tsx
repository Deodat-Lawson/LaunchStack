"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { useErrorText } from "~/lib/tools/errorText";

import { vantageApi, type CommitmentDto, type TopicDto } from "../api";
import { CheckInRow } from "../_components/CheckInRow";
import { Field, FormError } from "../_components/Primitives";
import { DecisionDialog } from "../_components/TopicDialogs";
import { WeekSuggestions } from "../_components/WeekSuggestions";
import { useOneClick } from "../_lib/actions";
import { addDaysIso, todayIso } from "../_lib/format";
import { useHiddenSuggestions } from "../_lib/hidden";
import { weekSuggestions } from "../_lib/suggestions";

type View = "open" | "resolved" | "all";

/**
 * The promise ledger: every commitment a meeting produced, with its owner,
 * due date and the test that settles it. Open ones first, late ones on top.
 * Above it, the same follow-through suggestions This week shows — promises
 * due, as Done / Missed / Not yet, and a held meeting's next steps to
 * commit to — answered with one click.
 */
export function CommitmentsScreen() {
    const t = useTranslations("vantage.commitments");
    const tc = useTranslations("common");
    const res = useResource("vantage:commitments", () => vantageApi.commitments());
    const overview = useResource("vantage:overview", () => vantageApi.overview());
    const hidden = useHiddenSuggestions();
    const reloadLedger = res.reload;
    const reloadOverview = overview.reload;
    const refresh = useCallback(
        () => Promise.all([reloadLedger(), reloadOverview()]),
        [reloadLedger, reloadOverview]
    );
    const { act, gone } = useOneClick(refresh);
    const [view, setView] = useState<View>("open");
    const [adding, setAdding] = useState(false);
    const [deciding, setDeciding] = useState<TopicDto | null>(null);

    const all = useMemo(() => res.data?.commitments ?? [], [res.data]);
    const today = todayIso();
    const open = useMemo(
        () =>
            all
                .filter(c => c.status === "open")
                .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0)),
        [all]
    );
    const resolved = useMemo(
        () =>
            all
                .filter(c => c.status !== "open")
                .sort((a, b) => ((a.resolvedAt ?? "") < (b.resolvedAt ?? "") ? 1 : -1)),
        [all]
    );
    const late = open.filter(c => c.dueOn < today).length;
    const followThrough = useMemo(
        () =>
            overview.data
                ? weekSuggestions(overview.data, { today, hidden }).filter(
                      g => g.id === "follow-through"
                  )
                : [],
        [overview.data, today, hidden]
    );
    const shown = view === "open" ? open : view === "resolved" ? resolved : [...open, ...resolved];

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={
                    res.data
                        ? t(late ? "subLate" : "sub", {
                              count: open.length,
                              late,
                              resolved: resolved.length,
                          })
                        : undefined
                }
                actions={
                    <Button size="sm" onClick={() => setAdding(true)}>
                        {t("add")}
                    </Button>
                }
            />

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {followThrough.length > 0 && (
                <WeekSuggestions
                    groups={followThrough}
                    act={act}
                    gone={gone}
                    onDecide={setDeciding}
                />
            )}

            <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("viewLabel")}>
                {(
                    [
                        [
                            "open",
                            open.length ? t("tabOpenCount", { count: open.length }) : t("open"),
                        ],
                        [
                            "resolved",
                            resolved.length
                                ? t("tabResolvedCount", { count: resolved.length })
                                : t("resolved"),
                        ],
                        ["all", tc("status.all")],
                    ] as [View, string][]
                ).map(([v, label]) => (
                    <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={view === v}
                        onClick={() => setView(v)}
                        className={cn(
                            "focus-visible:ring-brand/50 inline-flex h-8 items-center rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-[3px]",
                            view === v
                                ? "bg-panel text-ink shadow-1 font-medium"
                                : "text-ink-2 hover:bg-panel/60 hover:text-ink"
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <section>
                <SectionHeading
                    title={
                        view === "open"
                            ? t("open")
                            : view === "resolved"
                              ? t("resolved")
                              : t("everything")
                    }
                    aside={
                        view === "open" && late > 0 ? (
                            <span className="text-warn">{t("lateCount", { count: late })}</span>
                        ) : undefined
                    }
                />
                {res.loading ? (
                    <SkeletonRows rows={5} height={52} />
                ) : all.length === 0 ? (
                    <EmptyState
                        title={t("emptyTitle")}
                        body={t("emptyBody")}
                        action={
                            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                                {t("addByHand")}
                            </Button>
                        }
                    />
                ) : shown.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">{t("emptyView")}</p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {shown.map(c => (
                            <CheckInRow key={c.id} commitment={c} onChange={() => void refresh()} />
                        ))}
                    </div>
                )}
            </section>

            <AddCommitmentDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={() => void refresh()}
            />
            <DecisionDialog
                open={deciding !== null}
                onOpenChange={o => !o && setDeciding(null)}
                topic={deciding}
                onSaved={() => void refresh()}
            />
        </div>
    );
}

function AddCommitmentDialog({
    open,
    onOpenChange,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSaved: (c: CommitmentDto) => void;
}) {
    const errorText = useErrorText();
    const t = useTranslations("vantage.commitments");
    const tt = useTranslations("vantage.topicDialog");
    const td = useTranslations("vantage.decisionDialog");
    const tc = useTranslations("common");
    const [title, setTitle] = useState("");
    const [owner, setOwner] = useState("");
    const [dueOn, setDueOn] = useState(addDaysIso(todayIso(), 7));
    const [test, setTest] = useState("");
    const [shared, setShared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setTitle("");
        setOwner("");
        setDueOn(addDaysIso(todayIso(), 7));
        setTest("");
        setShared(false);
        setError(null);
    }, [open]);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const { commitment } = await vantageApi.addCommitment({
                title,
                owner,
                dueOn,
                test: test || null,
                shared,
            });
            toast(t("added"));
            onSaved(commitment);
            onOpenChange(false);
        } catch (e) {
            setError(errorText(e, tt("saveError")));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{t("add")}</DialogTitle>
                    <DialogDescription>{t("addDescription")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label={td("action")} htmlFor="c-title">
                        <Input
                            id="c-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder={t("actionPlaceholder")}
                        />
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label={tt("owner")} htmlFor="c-owner">
                            <Input
                                id="c-owner"
                                value={owner}
                                onChange={e => setOwner(e.target.value)}
                                placeholder={tt("ownerPlaceholder")}
                            />
                        </Field>
                        <Field label={tt("due")} htmlFor="c-due">
                            <Input
                                id="c-due"
                                type="date"
                                value={dueOn}
                                onChange={e => setDueOn(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field label={td("test")} htmlFor="c-test" hint={t("testHint")}>
                        <Input
                            id="c-test"
                            value={test}
                            onChange={e => setTest(e.target.value)}
                            placeholder={td("testPlaceholder")}
                        />
                    </Field>
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-ink-2 text-[12.5px]">{td("visible")}</div>
                        <Switch
                            checked={shared}
                            onCheckedChange={setShared}
                            aria-label={tt("sharedAria")}
                        />
                    </div>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !title.trim() || !owner.trim() || !dueOn}
                    >
                        {tc("actions.add")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
