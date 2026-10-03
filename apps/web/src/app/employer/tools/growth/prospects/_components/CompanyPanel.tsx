"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import {
    ProspectsApiError,
    prospectsApi,
    type CompanyDetail,
    type PersonRow,
    type SalesStage,
} from "../api";
import { relativeTime, shortDate } from "../../_lib/format";
import { useResource } from "../../_lib/useResource";
import { EmptyState, InlineError } from "../../_components/EmptyState";
import { Panel } from "../../_components/Panel";
import { SkeletonBlock } from "../../_components/SkeletonRows";
import { ClaimText, evidenceAnchorId } from "./Citation";
import { EmailStatus, canOutreach } from "./EmailStatus";
import { FitMeter } from "./FitMeter";
import { SourceChip } from "./SourceChip";
import { StageMenu, StagePill } from "./StagePill";

function Block({
    title,
    aside,
    children,
}: {
    title: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="mb-6">
            <h2 className="text-ink mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
                {title}
                {aside && <span className="text-ink-3 text-xs font-normal">{aside}</span>}
            </h2>
            {children}
        </section>
    );
}

function reasonOf(e: unknown, fallback: string): string {
    if (
        e instanceof ProspectsApiError &&
        e.body &&
        typeof e.body === "object" &&
        "reason" in e.body
    )
        return String((e.body as { reason: unknown }).reason);
    return e instanceof Error ? e.message : fallback;
}

/**
 * A company as a side peek: the deal at the top where it is acted on, then
 * the profile with every claim cited. Previous and next walk the list behind
 * the panel, so triage never leaves it.
 */
export function CompanyPanel({
    id,
    onClose,
    onPrev,
    onNext,
    onChanged,
}: {
    id: string | null;
    onClose: () => void;
    onPrev: (() => void) | null;
    onNext: (() => void) | null;
    /** The list behind the panel should reload: a stage, an exclusion, an owner changed. */
    onChanged: () => void;
}) {
    const res = useResource(id ? `company:${id}` : null, () => prospectsApi.company(id!));
    const c = res.data?.company ?? null;
    const [outreachOpen, setOutreachOpen] = useState(false);
    const [nextStep, setNextStep] = useState("");
    const [nextStepAt, setNextStepAt] = useState("");
    const [editingNext, setEditingNext] = useState(false);

    useEffect(() => {
        if (!c) return;
        setNextStep(c.deal.nextStep ?? "");
        setNextStepAt(c.deal.nextStepAt ? c.deal.nextStepAt.slice(0, 10) : "");
        setEditingNext(false);
    }, [c]);

    const patchDeal = async (
        patch: Parameters<typeof prospectsApi.patchDeal>[1],
        done?: string
    ) => {
        if (!c) return;
        try {
            const { deal } = await prospectsApi.patchDeal(c.deal.id, patch);
            res.mutate(current => ({ company: { ...current.company, deal, stage: deal.stage } }));
            if (done) toast.success(done);
            onChanged();
        } catch (e) {
            toast.error(reasonOf(e, "Could not update the deal"));
        }
    };

    const toggleExcluded = async () => {
        if (!c) return;
        try {
            await prospectsApi.setExcluded([c.id], !c.excluded);
            await res.reload();
            toast.success(c.excluded ? "Back in the segment" : "Excluded from future runs");
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update");
        }
    };

    return (
        <Panel
            open={id !== null}
            onOpenChange={open => !open && onClose()}
            size="lg"
            title={
                c ? (
                    <span className="flex min-w-0 items-center gap-3">
                        <span className="truncate">{c.name}</span>
                        {c.isNew && (
                            <span className="bg-brand-soft text-brand-ink rounded px-1.5 py-px text-[10.5px] font-medium">
                                new
                            </span>
                        )}
                    </span>
                ) : (
                    <Skeleton className="h-5 w-56" />
                )
            }
            description={
                c ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {c.domain && (
                            <a
                                href={`https://${c.domain}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-ink inline-flex items-center gap-1 font-mono text-[12px] hover:underline"
                            >
                                {c.domain}
                                <ExternalLink className="size-3" />
                            </a>
                        )}
                        <span>{c.hq}</span>
                        {c.sizeBand && <span>{c.sizeBand} staff</span>}
                        <span>{c.archetype}</span>
                    </span>
                ) : undefined
            }
            header={
                c && (
                    <div className="flex flex-wrap items-center gap-2">
                        <StageMenu
                            stage={c.deal.stage}
                            moves={c.deal.allowedMoves}
                            onMove={(stage: SalesStage) => void patchDeal({ stage })}
                            disabled={c.excluded}
                        />
                        <FitMeter value={c.fit} threshold={c.fitThreshold} label="Fit" />
                        <span className="ml-auto flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={!onPrev}
                                onClick={() => onPrev?.()}
                                aria-label="Previous company"
                            >
                                <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={!onNext}
                                onClick={() => onNext?.()}
                                aria-label="Next company"
                            >
                                <ArrowDown className="size-3.5" />
                            </Button>
                        </span>
                    </div>
                )
            }
            footer={
                c && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => void toggleExcluded()}>
                            {c.excluded ? "Include again" : "Exclude"}
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setOutreachOpen(true)}
                            disabled={c.excluded || c.people.length === 0}
                            title={c.people.length === 0 ? "No people found yet" : undefined}
                        >
                            Add people to outreach
                        </Button>
                    </div>
                )
            }
        >
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {!c ? (
                <>
                    <SkeletonBlock lines={3} className="mb-6" />
                    <SkeletonBlock lines={4} className="mb-6" />
                    <SkeletonBlock lines={5} />
                </>
            ) : (
                <>
                    {c.excluded && (
                        <p className="border-line bg-panel-2 text-ink-2 mb-5 rounded-md border px-3 py-2 text-[13px]">
                            Excluded{c.excludedReason ? `: ${c.excludedReason}` : ""}. It will not
                            appear in future runs and cannot be added to outreach.
                        </p>
                    )}

                    <Block title="Deal">
                        <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-[13px]">
                            <dt className="text-ink-3">Stage</dt>
                            <dd>
                                <StagePill stage={c.deal.stage} staleDays={c.deal.staleDays} />
                                <span className="text-ink-3 ml-1.5 text-xs">
                                    since {shortDate(c.deal.stageChangedAt)}
                                </span>
                            </dd>
                            <dt className="text-ink-3">Owner</dt>
                            <dd className="flex items-center gap-2">
                                {c.deal.ownerName ? (
                                    <>
                                        <Avatar className="size-5">
                                            <AvatarFallback className="text-[9px]">
                                                {c.deal.ownerInitials}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="text-ink">{c.deal.ownerName}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-ink-3">Unassigned</span>
                                        <button
                                            type="button"
                                            className="text-brand-ink focus-visible:ring-brand/50 rounded-sm text-xs outline-none hover:underline focus-visible:ring-2"
                                            onClick={() =>
                                                void patchDeal(
                                                    { ownerName: "You" },
                                                    "You own this deal"
                                                )
                                            }
                                        >
                                            Take it
                                        </button>
                                    </>
                                )}
                            </dd>
                            <dt className="text-ink-3">Next step</dt>
                            <dd>
                                {editingNext ? (
                                    <form
                                        className="flex flex-col gap-1.5"
                                        onSubmit={e => {
                                            e.preventDefault();
                                            void patchDeal(
                                                {
                                                    nextStep: nextStep.trim()
                                                        ? nextStep.trim()
                                                        : null,
                                                    nextStepAt: nextStepAt
                                                        ? new Date(
                                                              `${nextStepAt}T09:00:00`
                                                          ).toISOString()
                                                        : null,
                                                },
                                                "Next step saved"
                                            ).then(() => setEditingNext(false));
                                        }}
                                    >
                                        <Input
                                            autoFocus
                                            value={nextStep}
                                            onChange={e => setNextStep(e.target.value)}
                                            placeholder="Call after the intro email"
                                            className="h-8 text-[13px]"
                                            aria-label="Next step"
                                        />
                                        <div className="flex items-center gap-1.5">
                                            <Input
                                                type="date"
                                                value={nextStepAt}
                                                onChange={e => setNextStepAt(e.target.value)}
                                                className="h-8 text-[13px]"
                                                aria-label="Due date"
                                            />
                                            <Button type="submit" size="sm">
                                                Save
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setEditingNext(false)}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        className="focus-visible:ring-brand/50 rounded-sm text-left outline-none hover:underline focus-visible:ring-2"
                                        onClick={() => setEditingNext(true)}
                                    >
                                        {c.deal.nextStep ? (
                                            <span className="text-ink">
                                                {c.deal.nextStep}
                                                {c.deal.nextStepAt && (
                                                    <span className="text-ink-3">
                                                        {" "}
                                                        · {shortDate(c.deal.nextStepAt)}
                                                    </span>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="text-ink-3">None yet · set one</span>
                                        )}
                                    </button>
                                )}
                            </dd>
                        </dl>
                    </Block>

                    <Block
                        title="People"
                        aside={c.people.length > 0 ? `${c.people.length} found` : undefined}
                    >
                        {c.people.length === 0 ? (
                            <p className="text-ink-3 text-[13px]">
                                No people found yet. Public mailboxes are read from each
                                company&apos;s own pages during a run.
                            </p>
                        ) : (
                            <ul className="border-line divide-line-2 divide-y rounded-md border">
                                {c.people.map(p => (
                                    <PersonLine key={p.id} p={p} />
                                ))}
                            </ul>
                        )}
                    </Block>

                    {c.about.length === 0 ? (
                        <EmptyState
                            title="Not profiled yet"
                            body="This company was found but the profile step has not run for it. It will be profiled in the next run if it stays above the fit threshold."
                        />
                    ) : (
                        <>
                            <Block title="About">
                                <p className="text-ink text-sm leading-relaxed">
                                    {c.about.map((claim, i) => (
                                        <span key={i}>
                                            <ClaimText claim={claim} evidence={c.evidence} />{" "}
                                        </span>
                                    ))}
                                </p>
                            </Block>
                            <Block title="Why they fit">
                                <ul className="text-ink marker:text-ink-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                                    {c.whyFit.map((claim, i) => (
                                        <li key={i}>
                                            <ClaimText claim={claim} evidence={c.evidence} />
                                        </li>
                                    ))}
                                    {c.openQuestions.map((q, i) => (
                                        <li key={`q-${i}`} className="text-ink-2">
                                            Open question: {q}
                                        </li>
                                    ))}
                                </ul>
                                {c.fitBreakdown && c.fit !== null && (
                                    <dl className="text-ink-2 mt-3 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-xs tabular-nums">
                                        <dt className="text-ink-3">Buyer type</dt>
                                        <dd>
                                            {c.fitBreakdown.archetype[0]} /{" "}
                                            {c.fitBreakdown.archetype[1]}
                                        </dd>
                                        <dt className="text-ink-3">Size</dt>
                                        <dd>
                                            {c.fitBreakdown.size[0]} / {c.fitBreakdown.size[1]}
                                        </dd>
                                        <dt className="text-ink-3">Geography</dt>
                                        <dd>
                                            {c.fitBreakdown.geography[0]} /{" "}
                                            {c.fitBreakdown.geography[1]}
                                        </dd>
                                        <dt className="text-ink-3">Signals</dt>
                                        <dd>
                                            {c.fitBreakdown.signals[0]} /{" "}
                                            {c.fitBreakdown.signals[1]}
                                        </dd>
                                        <dt className="text-ink-3">Not a fit</dt>
                                        <dd
                                            className={cn(
                                                c.fitBreakdown.disqualifiers.length && "text-warn"
                                            )}
                                        >
                                            {c.fitBreakdown.disqualifiers.length
                                                ? c.fitBreakdown.disqualifiers.join(", ")
                                                : "none"}
                                        </dd>
                                    </dl>
                                )}
                            </Block>
                            {c.signals.length > 0 && (
                                <Block title="Signals">
                                    {c.signals.map((s, i) => (
                                        <div
                                            key={i}
                                            className="grid grid-cols-[84px_1fr] gap-3 py-1.5 text-sm"
                                        >
                                            <span className="text-ink-3 pt-px text-xs">
                                                {s.when}
                                            </span>
                                            <span className="text-ink">
                                                <ClaimText
                                                    claim={{ text: s.text, cites: s.cites }}
                                                    evidence={c.evidence}
                                                />
                                            </span>
                                        </div>
                                    ))}
                                </Block>
                            )}
                            <Block
                                title="Evidence"
                                aside={`${c.evidence.length} sources${c.profiledAt ? `, fetched ${relativeTime(c.profiledAt)}` : ""}`}
                            >
                                <ol>
                                    {c.evidence.map(e => (
                                        <li
                                            key={e.n}
                                            id={evidenceAnchorId(e.n)}
                                            className="border-line-2 data-[flash=1]:bg-brand-soft grid scroll-mt-24 grid-cols-[24px_1fr] gap-2.5 rounded-md border-t py-2.5 text-[13px] transition-colors duration-500 first:border-t-0 motion-reduce:transition-none"
                                        >
                                            <span className="text-brand-ink pt-0.5 font-mono text-[11px]">
                                                {e.n}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-ink font-medium">
                                                    {e.title}
                                                </div>
                                                <a
                                                    href={e.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-ink-3 hover:text-brand-ink block truncate font-mono text-[11px]"
                                                >
                                                    {e.host}
                                                </a>
                                                <p className="text-ink-2 mt-1 leading-relaxed">
                                                    “{e.quote}”
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </Block>
                        </>
                    )}

                    <Block title="Found via">
                        <div className="flex flex-wrap gap-1.5">
                            {c.foundVia.map(f => (
                                <SourceChip
                                    key={f.sourceId}
                                    label={f.label}
                                    kind={f.kind}
                                    url={f.url}
                                    at={f.at}
                                />
                            ))}
                        </div>
                        {c.profileDocumentTitle && (
                            <p className="text-ink-3 mt-2 text-xs">
                                Profile saved to Sources as “{c.profileDocumentTitle}”.
                            </p>
                        )}
                    </Block>
                    <OutreachDialog
                        open={outreachOpen}
                        onOpenChange={setOutreachOpen}
                        company={c}
                    />
                </>
            )}
        </Panel>
    );
}

function PersonLine({ p }: { p: PersonRow }) {
    return (
        <li className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5 px-3 py-2 text-[13px]">
            <Avatar className="size-7">
                <AvatarFallback>{p.initials}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
                <span className="text-ink block truncate font-medium">{p.name}</span>
                <span className="text-ink-3 block truncate text-xs">
                    {p.title}
                    {p.email && <span className="font-mono"> · {p.email}</span>}
                </span>
            </span>
            <EmailStatus status={p.emailStatus} />
        </li>
    );
}

function OutreachDialog({
    open,
    onOpenChange,
    company,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    company: CompanyDetail;
}) {
    const eligible = company.people.filter(p => canOutreach(p.emailStatus) && !p.blockedReason);
    const hasInbox = company.people.some(p => p.emailStatus === "generic" && !p.blockedReason);
    const [chosen, setChosen] = useState<Set<string>>(() => new Set(eligible.map(p => p.id)));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) setChosen(new Set(eligible.map(p => p.id)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, company.id]);

    const submit = async () => {
        setBusy(true);
        try {
            const result =
                chosen.size > 0
                    ? await prospectsApi.outreach({ personIds: [...chosen] })
                    : await prospectsApi.outreach({ companyIds: [company.id] });
            toast.success(
                `Campaign drafted in Email with ${result.people} ${result.people === 1 ? "person" : "people"}. Approve it there; nothing is sent from here.`
            );
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not draft outreach");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add people to outreach</DialogTitle>
                    <DialogDescription>
                        Drafts a campaign in Email for {company.name}. You approve it there.
                    </DialogDescription>
                </DialogHeader>
                <ul className="border-line divide-line-2 divide-y rounded-md border">
                    {company.people.map(p => {
                        const ok = canOutreach(p.emailStatus) && !p.blockedReason;
                        return (
                            <li
                                key={p.id}
                                className="flex items-center gap-3 px-3 py-2 text-[13px]"
                            >
                                <Checkbox
                                    id={`o-${p.id}`}
                                    checked={chosen.has(p.id)}
                                    disabled={!ok}
                                    onCheckedChange={checked =>
                                        setChosen(prev => {
                                            const next = new Set(prev);
                                            if (checked) next.add(p.id);
                                            else next.delete(p.id);
                                            return next;
                                        })
                                    }
                                />
                                <label
                                    htmlFor={`o-${p.id}`}
                                    className="min-w-0 flex-1 cursor-pointer"
                                >
                                    <span className="text-ink block truncate font-medium">
                                        {p.name}
                                    </span>
                                    <span className="text-ink-3 block truncate text-xs">
                                        {p.title}
                                        {p.email && (
                                            <>
                                                {" "}
                                                · <span className="font-mono">{p.email}</span>
                                            </>
                                        )}
                                    </span>
                                    {!ok && (
                                        <span className="text-ink-3 block text-xs">
                                            {p.blockedReason ??
                                                (p.emailStatus === "guess"
                                                    ? "Guessed address, confirm it first"
                                                    : "Shared inbox, not for a personal note")}
                                        </span>
                                    )}
                                </label>
                                <EmailStatus status={p.emailStatus} />
                            </li>
                        );
                    })}
                </ul>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void submit()}
                        disabled={busy || (chosen.size === 0 && !hasInbox)}
                    >
                        {chosen.size > 0
                            ? `Draft campaign for ${chosen.size}`
                            : "Draft to the public inbox"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
