"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolActive, useToolRouter } from "~/components/tool-app/nav";

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
import {
    ProspectsApiError,
    prospectsApi,
    type CompanyDetail,
    type PeopleSearchProgress,
    type PersonRow,
    type SalesStage,
} from "../api";
import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { useProspects } from "../_lib/context";
import { useErrorText } from "~/lib/tools/errorText";
import { neighbours } from "../_lib/listOrder";
import { useResource } from "~/lib/tools/useResource";
import { ClaimText, evidenceAnchorId } from "../_components/Citation";
import { EmailStatus, canOutreach } from "../_components/EmailStatus";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { FitMeter } from "~/components/tools/FitMeter";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { PeopleSheet } from "../_components/PeopleSheet";
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
        <section className="border-line border-t py-5 first:border-t-0 first:pt-0">
            <h2 className="text-ink mb-3 flex items-baseline gap-2 text-sm font-semibold">
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
            <h3 className="text-ink mb-2.5 flex items-center justify-between text-sm font-semibold">
                <span>{title}</span>
                {aside}
            </h3>
            {children}
        </section>
    );
}

const EVIDENCE_PREVIEW = 3;

function FitPart({ label, value }: { label: string; value: [number, number] }) {
    const [got, max] = value;
    return (
        <div className="grid grid-cols-[92px_1fr_48px] items-center gap-3 text-[13px] tabular-nums">
            <span className="text-ink-3">{label}</span>
            <span className="bg-line-2 h-1.5 overflow-hidden rounded-full" aria-hidden>
                <span
                    className="bg-ink-3 block h-full rounded-full"
                    style={{ width: `${max ? (got / max) * 100 : 0}%` }}
                />
            </span>
            <span className="text-ink-2 text-right">
                {got}/{max}
            </span>
        </div>
    );
}

export function CompanyScreen({ id }: { id: string }) {
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common.actions");
    const { relativeTime, shortDate, joinList } = useGrowthFormat();
    const ts = useTranslations("growth.server");
    const word = useCopyText();
    const errorText = useErrorText();
    const { href } = useProspects();
    const router = useToolRouter();
    const active = useToolActive();
    const opened = useRef<string | null>(null);
    const res = useResource(`company:${id}`, () => {
        const research = opened.current !== id;
        opened.current = id;
        return prospectsApi.company(id, { research }).catch(error => {
            if (opened.current === id) opened.current = null;
            throw error;
        });
    });
    const c = res.data?.company ?? null;
    const [researching, setResearching] = useState(false);
    const [peopleOpen, setPeopleOpen] = useState(false);
    const [peopleRun, setPeopleRun] = useState<"running" | "done" | "failed">("done");
    const [peopleStartedAt, setPeopleStartedAt] = useState<number | null>(null);
    const [peopleProgress, setPeopleProgress] = useState<PeopleSearchProgress | null>(null);
    const sawPeopleRunning = useRef(false);
    const [showAllEvidence, setShowAllEvidence] = useState(false);
    const [outreachOpen, setOutreachOpen] = useState(false);
    // A company researched twice logs the same line twice; one is enough.
    const signals = useMemo(() => {
        const seen = new Set<string>();
        return (c?.signals ?? []).filter(s => {
            const key = `${s.at ?? s.when}|${s.text}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [c?.signals]);
    const [nextStep, setNextStep] = useState("");
    const [nextStepAt, setNextStepAt] = useState("");
    const [editingNext, setEditingNext] = useState(false);

    const nav = useMemo(() => neighbours(id), [id]);
    // Only while this tab is the one being used; hidden tabs stay mounted.
    useEffect(() => {
        if (!active) return;
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
    }, [active, nav, href, router]);

    useEffect(() => {
        if (!c) return;
        setNextStep(c.deal.nextStep ?? "");
        setNextStepAt(c.deal.nextStepAt ? c.deal.nextStepAt.slice(0, 10) : "");
        setResearching(Boolean(c.researching));
        if (c.peopleSearch) setPeopleProgress(c.peopleSearch);
    }, [c]);

    useEffect(() => {
        if (peopleRun !== "running") return;
        if (researching || c?.researching) sawPeopleRunning.current = true;
        else if (sawPeopleRunning.current) {
            sawPeopleRunning.current = false;
            setPeopleRun("done");
        }
    }, [peopleRun, researching, c?.researching]);

    useEffect(() => {
        if (!researching || !active) return;
        const timer = window.setInterval(() => {
            void res.reload();
        }, 2000);
        return () => window.clearInterval(timer);
    }, [researching, active, res]);

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
                    : errorText(e, t("company.updateDealFailed"))
            );
        }
    };

    const move = (stage: SalesStage) => void patchDeal({ stage }, undefined);

    const toggleExcluded = async () => {
        if (!c) return;
        try {
            await prospectsApi.setExcluded([c.id], !c.excluded);
            await res.reload();
            toast.success(c.excluded ? t("company.backInSegment") : t("company.excludedToast"));
        } catch (e) {
            toast.error(errorText(e, t("common.updateFailed")));
        }
    };

    const findPeople = async () => {
        if (!c) return;
        setPeopleOpen(true);
        setPeopleRun("running");
        setPeopleStartedAt(Date.now());
        setPeopleProgress(null);
        sawPeopleRunning.current = false;
        try {
            const { company } = await prospectsApi.company(c.id, { research: "refresh" });
            res.mutate(() => ({ company }));
            setResearching(true);
        } catch (e) {
            setPeopleRun("failed");
            toast.error(errorText(e, t("company.findPeopleFailed")));
        }
    };

    // Gone (removed, or a link from another workspace): say so, and do not
    // remember it as the tab's last screen.
    if (res.errorStatus === 404) {
        return (
            <ToolNotFound
                home={href("/companies")}
                homeLabel={t("common.companies")}
                title={t("company.goneTitle")}
                body={t("company.goneBody")}
            />
        );
    }

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
                <ToolLink href={href("/companies")} className="hover:text-ink">
                    {t("common.companies")}
                </ToolLink>
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
                            aria-label={t("company.previous")}
                        >
                            <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={!nav.next}
                            onClick={() => nav.next && router.push(href(`/companies/${nav.next}`))}
                            aria-label={t("company.next")}
                        >
                            <ArrowDown className="size-3.5" />
                        </Button>
                    </span>
                )}
            </div>

            <header className="border-line @max-md:grid-cols-1 mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b pb-5">
                <div className="min-w-0">
                    <h1 className="text-ink flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-[-0.02em]">
                        {c ? c.name : <Skeleton className="h-6 w-72" />}
                        {c?.foundInLastRun && (
                            <span className="bg-brand-soft text-brand-ink rounded px-1.5 py-px text-[11px] font-medium">
                                {t("companies.foundInLastRun")}
                            </span>
                        )}
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
                            {c.sizeBand && <span>{t("company.staff", { size: c.sizeBand })}</span>}
                            <span>{c.archetype}</span>
                            <FitMeter
                                value={c.fit}
                                threshold={c.fitThreshold}
                                label={t("common.fit")}
                            />
                        </div>
                    )}
                </div>
                {c && (
                    <div className="@max-md:justify-start flex flex-wrap items-center justify-end gap-2">
                        <StageMenu
                            stage={c.deal.stage}
                            moves={c.deal.allowedMoves}
                            onMove={move}
                            disabled={c.excluded}
                        />
                        <Button variant="outline" size="sm" onClick={() => void toggleExcluded()}>
                            {c.excluded ? t("common.includeAgain") : t("common.exclude")}
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setOutreachOpen(true)}
                            disabled={c.excluded || c.people.length === 0}
                            title={c.people.length === 0 ? t("company.noPeopleYet") : undefined}
                        >
                            {t("company.addPeople")}
                        </Button>
                    </div>
                )}
            </header>

            {c?.excluded && (
                <p className="border-line bg-panel-2 text-ink-2 mb-6 rounded-md border px-3 py-2 text-[13px]">
                    {c.excludedReason
                        ? t("company.excludedNoteReason", {
                              reason: word(c.excludedReasonCopy, c.excludedReason),
                          })
                        : t("company.excludedNote")}
                </p>
            )}

            <div className="@max-lg:grid-cols-1 grid grid-cols-[1fr_340px] gap-5">
                <div className="min-w-0">
                    {!c ? (
                        <>
                            <SkeletonBlock lines={4} className="mb-8" />
                            <SkeletonBlock lines={3} className="mb-8" />
                            <SkeletonBlock lines={5} />
                        </>
                    ) : c.about.length === 0 ? (
                        <EmptyState
                            title={
                                c.researching || researching
                                    ? t("company.researching")
                                    : t("company.notProfiled")
                            }
                            body={
                                c.researching || researching
                                    ? t("company.researchingBody")
                                    : t("company.notProfiledBody")
                            }
                        />
                    ) : (
                        <>
                            <Block title={t("company.about")}>
                                <p className="text-ink max-w-[70ch] text-sm leading-relaxed">
                                    {c.about.map((claim, i) => (
                                        <span key={i}>
                                            <ClaimText claim={claim} evidence={c.evidence} />{" "}
                                        </span>
                                    ))}
                                </p>
                            </Block>
                            <Block title={t("company.whyFit")}>
                                <ul className="text-ink marker:text-ink-4 max-w-[70ch] list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                                    {c.whyFit.map((claim, i) => (
                                        <li key={i}>
                                            <ClaimText claim={claim} evidence={c.evidence} />
                                        </li>
                                    ))}
                                    {c.openQuestions.map((q, i) => (
                                        <li key={`q-${i}`} className="text-ink-2">
                                            {t("company.openQuestion", { question: q })}
                                        </li>
                                    ))}
                                </ul>
                            </Block>
                            {signals.length > 0 && (
                                <Block title={t("company.signals")}>
                                    <div className="max-w-[70ch]">
                                        {signals.map((s, i) => (
                                            <div
                                                key={i}
                                                className="grid grid-cols-[84px_1fr] gap-3 py-1.5 text-sm"
                                            >
                                                <span className="text-ink-3 pt-px text-xs">
                                                    {s.at ? shortDate(s.at) : s.when}
                                                </span>
                                                <span className="text-ink">
                                                    <ClaimText
                                                        claim={{
                                                            text: s.text,
                                                            cites: s.cites,
                                                            copy: s.copy,
                                                        }}
                                                        evidence={c.evidence}
                                                    />
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </Block>
                            )}
                            <Block
                                title={t("company.evidence")}
                                aside={
                                    c.profiledAt
                                        ? t("company.evidenceAsideFetched", {
                                              count: c.evidence.length,
                                              when: relativeTime(c.profiledAt),
                                          })
                                        : t("company.evidenceAside", { count: c.evidence.length })
                                }
                            >
                                <ol className="max-w-[70ch]">
                                    {(showAllEvidence
                                        ? c.evidence
                                        : c.evidence.slice(0, EVIDENCE_PREVIEW)
                                    ).map(e => (
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
                                {c.evidence.length > EVIDENCE_PREVIEW && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-ink-2 mt-1 px-0"
                                        onClick={() => setShowAllEvidence(v => !v)}
                                    >
                                        {showAllEvidence
                                            ? t("company.showLessEvidence")
                                            : t("company.showAllEvidence", {
                                                  count: c.evidence.length,
                                              })}
                                    </Button>
                                )}
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
                            <Side title={t("company.deal")}>
                                <dl className="grid grid-cols-[78px_1fr] gap-x-3 gap-y-2 text-[13px]">
                                    <dt className="text-ink-3">{t("common.stage")}</dt>
                                    <dd>
                                        <StagePill
                                            stage={c.deal.stage}
                                            staleDays={c.deal.staleDays}
                                        />
                                        <span className="text-ink-3 ml-1.5 text-xs">
                                            {t("company.since", {
                                                date: shortDate(c.deal.stageChangedAt),
                                            })}
                                        </span>
                                    </dd>
                                    <dt className="text-ink-3">{t("company.owner")}</dt>
                                    <dd className="flex items-center gap-2">
                                        {c.deal.ownerName ? (
                                            <>
                                                <Avatar className="size-5">
                                                    <AvatarFallback className="text-[9px]">
                                                        {c.deal.ownerInitials}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span className="text-ink">
                                                    {c.deal.ownerIsViewer
                                                        ? ts("you")
                                                        : c.deal.ownerName}
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-ink-3">
                                                    {t("company.unassigned")}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="text-brand-ink text-xs hover:underline"
                                                    onClick={() =>
                                                        void patchDeal(
                                                            { ownerName: "You" },
                                                            t("company.youOwn")
                                                        )
                                                    }
                                                >
                                                    {t("company.takeIt")}
                                                </button>
                                            </>
                                        )}
                                    </dd>
                                    <dt className="text-ink-3">{t("company.nextStep")}</dt>
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
                                                        t("company.nextStepSaved")
                                                    ).then(() => setEditingNext(false));
                                                }}
                                            >
                                                <Input
                                                    autoFocus
                                                    value={nextStep}
                                                    onChange={e => setNextStep(e.target.value)}
                                                    placeholder={t("company.nextStepPlaceholder")}
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
                                                        aria-label={t("company.dueDate")}
                                                    />
                                                    <Button type="submit" size="sm">
                                                        {tc("save")}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => setEditingNext(false)}
                                                    >
                                                        {tc("cancel")}
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
                                                    <span className="text-ink-2 decoration-line underline underline-offset-4">
                                                        {t("company.setNextStep")}
                                                    </span>
                                                )}
                                            </button>
                                        )}
                                    </dd>
                                </dl>
                            </Side>

                            <Side
                                title={t("common.people")}
                                aside={
                                    c.excluded ? null : (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-ink-2 h-6 px-2 text-xs"
                                            title={t("company.findPeopleTitle")}
                                            onClick={() =>
                                                peopleRun === "running"
                                                    ? setPeopleOpen(true)
                                                    : void findPeople()
                                            }
                                        >
                                            {peopleRun === "running"
                                                ? t("company.findingPeople")
                                                : t("company.findPeople")}
                                        </Button>
                                    )
                                }
                            >
                                {c.people.length === 0 ? (
                                    <p className="text-ink-3 text-[13px]">
                                        {t("company.noPeople")}
                                    </p>
                                ) : (
                                    <ul>
                                        {c.people.map(p => (
                                            <PersonLine key={p.id} p={p} />
                                        ))}
                                    </ul>
                                )}
                                <p className="text-ink-3 mt-2 text-xs">
                                    {t("company.outreachRule")}
                                </p>
                            </Side>

                            {c.fitBreakdown && c.fit !== null && (
                                <Side title={t("company.fitTitle", { fit: c.fit })}>
                                    <div className="flex flex-col gap-2">
                                        <FitPart
                                            label={t("company.buyerType")}
                                            value={c.fitBreakdown.archetype}
                                        />
                                        <FitPart
                                            label={t("company.size")}
                                            value={c.fitBreakdown.size}
                                        />
                                        <FitPart
                                            label={t("company.geography")}
                                            value={c.fitBreakdown.geography}
                                        />
                                        <FitPart
                                            label={t("company.signals")}
                                            value={c.fitBreakdown.signals}
                                        />
                                    </div>
                                    {c.fitBreakdown.disqualifiers.length > 0 && (
                                        <p className="text-warn-ink mt-2.5 text-xs">
                                            {t("company.notAFitList", {
                                                list: joinList(c.fitBreakdown.disqualifiers),
                                            })}
                                        </p>
                                    )}
                                </Side>
                            )}

                            <Side title={t("company.foundVia")}>
                                <div className="flex flex-wrap gap-1.5">
                                    {c.foundVia.map(f => (
                                        <SourceChip
                                            key={f.sourceId}
                                            label={word(f.labelCopy, f.label)}
                                            kind={f.kind}
                                            url={f.url}
                                            at={f.at}
                                        />
                                    ))}
                                </div>
                                {c.profileDocumentTitle && (
                                    <p className="text-ink-3 mt-2 text-xs">
                                        {t("company.profileSaved", {
                                            title: c.profileDocumentTitle,
                                        })}
                                    </p>
                                )}
                            </Side>
                        </>
                    )}
                </aside>
            </div>

            {c && <OutreachDialog open={outreachOpen} onOpenChange={setOutreachOpen} company={c} />}
            {c && (
                <PeopleSheet
                    open={peopleOpen}
                    onOpenChange={setPeopleOpen}
                    companyName={c.name}
                    progress={peopleProgress}
                    run={peopleRun}
                    startedAt={peopleStartedAt}
                />
            )}
        </div>
    );
}

function PersonLine({ p }: { p: PersonRow }) {
    const t = useTranslations("growth.prospects");
    const word = useCopyText();
    return (
        <li className="border-line-2 grid grid-cols-[28px_1fr] items-start gap-2.5 border-t py-2 text-[13px] first:border-t-0">
            <Avatar className="mt-0.5 size-7">
                <AvatarFallback>{p.initials}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
                <span className="text-ink block truncate font-medium">
                    {word(p.nameCopy, p.name)}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                    {word(p.titleCopy, p.title)}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span
                        className={
                            p.email
                                ? "text-ink-2 truncate font-mono text-[11px]"
                                : "text-ink-4 text-[11px]"
                        }
                    >
                        {p.email ?? t("company.noEmail")}
                    </span>
                    {p.email && <EmailStatus status={p.emailStatus} />}
                </span>
                {p.sourceUrl?.includes("linkedin.com") ? (
                    <a
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink-2 mt-0.5 inline-flex max-w-full items-center gap-1 text-[11px] underline underline-offset-2"
                    >
                        <span className="truncate">{t("company.linkedinLink")}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                ) : p.emailStatus === "generic" ? null : p.linkedinSearchUrl ? (
                    <a
                        href={p.linkedinSearchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink-2 mt-0.5 inline-flex max-w-full items-center gap-1 text-[11px] underline underline-offset-2"
                    >
                        <span className="truncate">{t("company.openLinkedIn")}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                ) : (
                    <span className="text-ink-4 mt-0.5 block text-[11px]">
                        {t("company.noLinkedIn")}
                    </span>
                )}
                {p.linkedinStatus &&
                    p.linkedinStatus !== "search_error" &&
                    p.emailStatus !== "generic" && (
                    <span className="text-ink-4 mt-0.5 block text-[11px]">
                        {t(`company.linkedinStatus.${p.linkedinStatus}`)}
                    </span>
                )}
            </span>
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
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common.actions");
    const word = useCopyText();
    const errorText = useErrorText();
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
            toast.success(t("company.drafted", { count: result.people }));
            onOpenChange(false);
        } catch (e) {
            toast.error(errorText(e, t("common.outreachFailed")));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("company.dialogTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("company.dialogDescription", { company: company.name })}
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
                                        {word(p.nameCopy, p.name)}
                                    </span>
                                    <span className="text-ink-3 block truncate text-xs">
                                        {word(p.titleCopy, p.title)}
                                        {p.email && (
                                            <>
                                                {" "}
                                                · <span className="font-mono">{p.email}</span>
                                            </>
                                        )}
                                    </span>
                                    {!ok && (
                                        <span className="text-ink-3 block text-xs">
                                            {(p.blockedReason &&
                                                word(p.blockedReasonCopy, p.blockedReason)) ??
                                                (p.emailStatus === "guess"
                                                    ? t("company.guessed")
                                                    : t("company.sharedInbox"))}
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
                        {tc("cancel")}
                    </Button>
                    <Button
                        onClick={() => void submit()}
                        disabled={busy || (chosen.size === 0 && !hasInbox)}
                    >
                        {chosen.size > 0
                            ? t("company.draftFor", { count: chosen.size })
                            : t("company.draftInbox")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
