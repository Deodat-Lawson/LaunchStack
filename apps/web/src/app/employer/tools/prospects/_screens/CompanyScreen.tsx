"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { useProspects } from "../_lib/context";
import { neighbours } from "../_lib/listOrder";
import { relativeTime, shortDate } from "../_lib/format";
import { useResource } from "../_lib/useResource";
import { ClaimText, evidenceAnchorId } from "../_components/Citation";
import { EmailStatus, canOutreach } from "../_components/EmailStatus";
import { EmptyState, InlineError } from "../_components/EmptyState";
import { FitMeter } from "../_components/FitMeter";
import { SkeletonBlock } from "../_components/SkeletonRows";
import { SourceChip } from "../_components/SourceChip";
import { StageMenu, StagePill } from "../_components/StagePill";

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
        <section className="mb-7">
            <h2 className="text-ink mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
                {title}
                {aside && <span className="text-ink-3 text-xs font-normal">{aside}</span>}
            </h2>
            {children}
        </section>
    );
}

function Side({
    title,
    aside,
    children,
}: {
    title: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="border-line bg-panel mb-3.5 rounded-lg border px-3.5 py-3">
            <h3 className="text-ink-3 mb-2 flex items-center justify-between text-xs font-medium">
                <span>{title}</span>
                {aside}
            </h3>
            {children}
        </section>
    );
}

export function CompanyScreen({ id }: { id: string }) {
    const { href } = useProspects();
    const router = useRouter();
    const res = useResource(`company:${id}`, () => prospectsApi.company(id));
    const c = res.data?.company ?? null;
    const [outreachOpen, setOutreachOpen] = useState(false);
    const [nextStep, setNextStep] = useState("");
    const [nextStepAt, setNextStepAt] = useState("");
    const [editingNext, setEditingNext] = useState(false);

    const nav = useMemo(() => neighbours(id), [id]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === "ArrowDown" && nav.next) {
                e.preventDefault();
                router.push(href(`/companies/${nav.next}`));
            } else if (e.key === "ArrowUp" && nav.prev) {
                e.preventDefault();
                router.push(href(`/companies/${nav.prev}`));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [nav, href, router]);

    useEffect(() => {
        if (!c) return;
        setNextStep(c.deal.nextStep ?? "");
        setNextStepAt(c.deal.nextStepAt ? c.deal.nextStepAt.slice(0, 10) : "");
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
        } catch (e) {
            toast.error(
                e instanceof ProspectsApiError &&
                    e.body &&
                    typeof e.body === "object" &&
                    "reason" in e.body
                    ? String((e.body as { reason: unknown }).reason)
                    : e instanceof Error
                      ? e.message
                      : "Could not update the deal"
            );
        }
    };

    const move = (stage: SalesStage) => void patchDeal({ stage }, undefined);

    const toggleExcluded = async () => {
        if (!c) return;
        try {
            await prospectsApi.setExcluded([c.id], !c.excluded);
            await res.reload();
            toast.success(c.excluded ? "Back in the segment" : "Excluded from future runs");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update");
        }
    };

    if (res.error) {
        return (
            <div className="mx-auto max-w-[1100px]">
                <InlineError message={res.error} onRetry={() => void res.reload()} />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1100px]">
            <div className="text-ink-3 mb-3 flex items-center gap-3 text-xs">
                <Link href={href("/companies")} className="hover:text-ink">
                    Companies
                </Link>
                <span aria-hidden>/</span>
                <span className="text-ink font-medium">
                    {c?.name ?? <Skeleton className="inline-block h-3 w-40 align-middle" />}
                </span>
                {(nav.prev !== null || nav.next !== null) && (
                    <span className="ml-auto flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={!nav.prev}
                            onClick={() => nav.prev && router.push(href(`/companies/${nav.prev}`))}
                            aria-label="Previous company"
                        >
                            <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={!nav.next}
                            onClick={() => nav.next && router.push(href(`/companies/${nav.next}`))}
                            aria-label="Next company"
                        >
                            <ArrowDown className="size-3.5" />
                        </Button>
                    </span>
                )}
            </div>

            <header className="border-line mb-6 grid gap-4 border-b pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                    <h1 className="text-ink text-[22px] font-semibold tracking-[-0.02em]">
                        {c ? c.name : <Skeleton className="h-6 w-72" />}
                    </h1>
                    {c && (
                        <div className="text-ink-2 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                            {c.domain && (
                                <a
                                    href={`https://${c.domain}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-brand-ink inline-flex items-center gap-1 hover:underline"
                                >
                                    {c.domain}
                                    <ExternalLink className="size-3" />
                                </a>
                            )}
                            <span>{c.hq}</span>
                            {c.sizeBand && <span>{c.sizeBand} staff</span>}
                            <span>{c.archetype}</span>
                            <FitMeter value={c.fit} threshold={c.fitThreshold} label="Fit" />
                        </div>
                    )}
                </div>
                {c && (
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <StageMenu
                            stage={c.deal.stage}
                            moves={c.deal.allowedMoves}
                            onMove={move}
                            disabled={c.excluded}
                        />
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
                )}
            </header>

            {c?.excluded && (
                <p className="border-line bg-panel-2 text-ink-2 mb-6 rounded-md border px-3 py-2 text-[13px]">
                    Excluded{c.excludedReason ? `: ${c.excludedReason}` : ""}. It will not appear in
                    future runs and cannot be added to outreach.
                </p>
            )}

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
                <div className="min-w-0">
                    {!c ? (
                        <>
                            <SkeletonBlock lines={4} className="mb-8" />
                            <SkeletonBlock lines={3} className="mb-8" />
                            <SkeletonBlock lines={5} />
                        </>
                    ) : c.about.length === 0 ? (
                        <EmptyState
                            title="Not profiled yet"
                            body="This company was found but the profile step has not run for it. It will be profiled in the next run if it stays above the fit threshold."
                        />
                    ) : (
                        <>
                            <Block title="About">
                                <p className="text-ink max-w-[70ch] text-sm leading-relaxed">
                                    {c.about.map((claim, i) => (
                                        <span key={i}>
                                            <ClaimText claim={claim} evidence={c.evidence} />{" "}
                                        </span>
                                    ))}
                                </p>
                            </Block>
                            <Block title="Why they fit">
                                <ul className="text-ink marker:text-ink-4 max-w-[70ch] list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
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
                            </Block>
                            {c.signals.length > 0 && (
                                <Block title="Signals">
                                    <div className="max-w-[70ch]">
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
                                    </div>
                                </Block>
                            )}
                            <Block
                                title="Evidence"
                                aside={`${c.evidence.length} sources${c.profiledAt ? `, fetched ${relativeTime(c.profiledAt)}` : ""}`}
                            >
                                <ol className="max-w-[70ch]">
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
                </div>

                <aside>
                    {!c ? (
                        <>
                            <Skeleton className="mb-3.5 h-28 w-full rounded-lg" />
                            <Skeleton className="mb-3.5 h-40 w-full rounded-lg" />
                            <Skeleton className="h-20 w-full rounded-lg" />
                        </>
                    ) : (
                        <>
                            <Side title="Deal">
                                <dl className="grid grid-cols-[78px_1fr] gap-x-3 gap-y-2 text-[13px]">
                                    <dt className="text-ink-3">Stage</dt>
                                    <dd>
                                        <StagePill
                                            stage={c.deal.stage}
                                            staleDays={c.deal.staleDays}
                                        />
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
                                                    className="text-brand-ink text-xs hover:underline"
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
                                                />
                                                <div className="flex items-center gap-1.5">
                                                    <Input
                                                        type="date"
                                                        value={nextStepAt}
                                                        onChange={e =>
                                                            setNextStepAt(e.target.value)
                                                        }
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
                                                className="text-left hover:underline"
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
                                                    <span className="text-ink-3">
                                                        None yet · set one
                                                    </span>
                                                )}
                                            </button>
                                        )}
                                    </dd>
                                </dl>
                            </Side>

                            <Side
                                title="People"
                                aside={
                                    <span
                                        className="text-ink-4 text-xs"
                                        title="People search runs after the profile step"
                                    >
                                        Find more
                                    </span>
                                }
                            >
                                {c.people.length === 0 ? (
                                    <p className="text-ink-3 text-[13px]">
                                        No people found yet. They are looked up for the top
                                        companies after each run.
                                    </p>
                                ) : (
                                    <ul>
                                        {c.people.map(p => (
                                            <PersonLine key={p.id} p={p} />
                                        ))}
                                    </ul>
                                )}
                                <p className="text-ink-3 mt-2 text-xs">
                                    Verified and Found emails can go to outreach. A guess needs
                                    confirming first.
                                </p>
                            </Side>

                            <Side title="Found via">
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
                            </Side>

                            {c.fitBreakdown && c.fit !== null && (
                                <Side title={`Fit ${c.fit}`}>
                                    <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
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
                                </Side>
                            )}
                        </>
                    )}
                </aside>
            </div>

            {c && <OutreachDialog open={outreachOpen} onOpenChange={setOutreachOpen} company={c} />}
        </div>
    );
}

function PersonLine({ p }: { p: PersonRow }) {
    return (
        <li className="border-line-2 grid grid-cols-[28px_1fr_auto] items-center gap-2.5 border-t py-2 text-[13px] first:border-t-0">
            <Avatar className="size-7">
                <AvatarFallback>{p.initials}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
                <span className="text-ink block truncate font-medium">{p.name}</span>
                <span className="text-ink-3 block truncate text-xs">{p.title}</span>
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
    const [chosen, setChosen] = useState<Set<string>>(() => new Set(eligible.map(p => p.id)));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) setChosen(new Set(eligible.map(p => p.id)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, company.id]);

    const submit = async () => {
        setBusy(true);
        try {
            const result = await prospectsApi.outreach([...chosen]);
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
                    <Button onClick={() => void submit()} disabled={busy || chosen.size === 0}>
                        Draft campaign for {chosen.size}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
