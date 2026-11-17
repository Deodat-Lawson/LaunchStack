"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useLayoutEffect, useMemo, useRef } from "react";

import {
    useToolNav,
    useToolPathname,
    useToolRouter,
    useToolSearchParams,
} from "~/components/tool-app/nav";
import { cn } from "~/lib/utils";

import type { ProgramView } from "../api";
import { DiscoveryToolbar } from "../_components/DiscoveryToolbar";
import { ScoreControl } from "../_components/ScoreControl";
import { FIT_BAND_TEXT, Notice } from "../_components/ProgramFacts";
import { ProgramRow } from "../_components/ProgramRow";
import { RecommendedPrograms } from "../_components/RecommendedPrograms";
import { useAccelerators } from "../_lib/context";
import {
    DEFAULT_DISCOVERY_FILTERS,
    currentScore,
    filterPrograms,
    fitBand,
    rankPrograms,
    readDiscoveryFilters,
    recommendedPrograms,
    updateDiscoveryParams,
    type DiscoveryFilters,
    type FitBand,
} from "../_lib/discovery";
import { programPath } from "../_lib/screens";
import { useTracker } from "../_lib/tracker";
import {
    DEFAULT_VISION_FILTERS,
    applyVisionFilters,
    daysBetween,
    nextDeadline,
    readVisionFilters,
    updateVisionParams,
    type VisionFilters,
} from "../_lib/vision-filters";

/** How many of the best current fits the list recommends. */
const RECOMMENDED = 3;
/** The deadline window the header's "closing soon" figure counts and filters by. */
const SOON_WINDOW = "30";
/**
 * Where each visit to the list was scrolled, by tab history entry: the list scrolls
 * inside the screen, so the frame's own per-visit restore does not reach it.
 */
const listScroll = new Map<number, number>();

export function ProgramsScreen() {
    const t = useTranslations("accelerators");
    const locale = useLocale();
    const format = useFormatter();
    const { home } = useAccelerators();
    const { opportunities } = useTracker();
    const router = useToolRouter();
    const pathname = useToolPathname();
    const params = useToolSearchParams();
    const catalogue = readDiscoveryFilters(params);
    const vision = readVisionFilters(params);
    const today = new Date().toISOString().slice(0, 10);
    const programs = home?.programs;
    const ranked = useMemo(() => rankPrograms(programs ?? [], locale), [programs, locale]);
    const { q, fit, minScore, intake } = catalogue;
    const catalogueVisible = useMemo(
        () => filterPrograms(ranked, { q, fit, minScore, intake }, home?.details),
        [ranked, q, fit, minScore, intake, home?.details]
    );
    const { entryKey } = useToolNav();
    const scroller = useRef<HTMLDivElement | null>(null);
    // Back from a Program returns to the row it was opened from.
    useLayoutEffect(() => {
        if (scroller.current) scroller.current.scrollTop = listScroll.get(entryKey) ?? 0;
    }, [entryKey]);
    if (!home) return null;

    const visionContext = { details: home.details, tracker: opportunities ?? [], today };
    const visible = applyVisionFilters(catalogueVisible, vision, visionContext);
    // Facet counts: what each option would show alongside every other active filter.
    const countVision = (patch: Partial<VisionFilters>) =>
        applyVisionFilters(catalogueVisible, { ...vision, ...patch }, visionContext).length;
    const countCatalogue = (patch: Partial<DiscoveryFilters>) =>
        applyVisionFilters(
            filterPrograms(ranked, { q, fit, minScore, intake, ...patch }, home.details),
            vision,
            visionContext
        ).length;
    const queryString = params.toString();
    const navigate = (next: URLSearchParams) => {
        const search = next.toString();
        router.replace(search ? `${pathname}?${search}` : pathname);
    };
    const setCatalogue = (patch: Partial<DiscoveryFilters>) =>
        navigate(updateDiscoveryParams(params, patch));
    const setVision = (patch: Partial<VisionFilters>) =>
        navigate(updateVisionParams(params, patch));
    const resetFilters = () =>
        navigate(
            updateVisionParams(updateDiscoveryParams(params, DEFAULT_DISCOVERY_FILTERS), {
                ...DEFAULT_VISION_FILTERS,
                tracked: vision.tracked,
                sort: vision.sort,
            })
        );
    const trackedFor = (programId: string) =>
        (opportunities ?? [])
            .filter(item => item.programId === programId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const waitingForTracker =
        opportunities === null && (vision.tracked !== "any" || vision.priority !== "any");
    const hrefFor = (programId: string) =>
        `${programPath(programId)}${queryString ? `?${queryString}` : ""}`;
    const deadlineFor = (view: ProgramView) => nextDeadline(view.program, home.details, today);
    const recommended = recommendedPrograms(visible, RECOMMENDED);

    const scored = home.programs.filter(view => currentScore(view) !== null);
    const best = scored.reduce<number | null>(
        (top, view) => Math.max(top ?? 0, currentScore(view) ?? 0),
        null
    );
    const closingSoon = home.programs.filter(view => {
        const deadline = deadlineFor(view);
        return deadline !== null && daysBetween(today, deadline) <= Number(SOON_WINDOW);
    }).length;
    const soonActive = vision.deadline === SOON_WINDOW;

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
            <div className="shrink-0 space-y-5">
                <header className="border-line space-y-4 border-b pb-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                        <div className="min-w-0 max-w-xl space-y-1.5">
                            <h1 className="display text-ink text-3xl tracking-tight">
                                {t("home.title")}
                            </h1>
                            <p className="text-ink-2 text-sm leading-relaxed">
                                {t("home.description")}
                            </p>
                        </div>
                        <ScoreControl visible={visible} />
                    </div>
                    <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                        <Stat
                            label={t("home.stats.programs")}
                            value={format.number(home.programs.length)}
                        />
                        <Stat
                            label={t("home.stats.scored")}
                            value={format.number(scored.length)}
                            active={catalogue.fit === "scored"}
                            onSelect={() =>
                                setCatalogue({
                                    fit: catalogue.fit === "scored" ? "all" : "scored",
                                })
                            }
                        />
                        <Stat
                            label={t("home.stats.best")}
                            value={best === null ? "—" : format.number(best)}
                            tone={best === null ? undefined : fitBand(best)}
                        />
                        <Stat
                            label={t("home.stats.closingSoon", { days: Number(SOON_WINDOW) })}
                            value={format.number(closingSoon)}
                            active={soonActive}
                            onSelect={() =>
                                setVision({ deadline: soonActive ? "any" : SOON_WINDOW })
                            }
                        />
                    </ul>
                </header>
                <DiscoveryToolbar
                    catalogue={catalogue}
                    vision={vision}
                    details={home.details}
                    resultCount={visible.length}
                    totalCount={home.programs.length}
                    countVision={countVision}
                    countCatalogue={countCatalogue}
                    onCatalogue={setCatalogue}
                    onVision={setVision}
                    onReset={resetFilters}
                />
            </div>

            {/* Only the list scrolls (in a tab 860px or wider); narrower, the screen scrolls as one. */}
            <div
                ref={scroller}
                onScroll={event => listScroll.set(entryKey, event.currentTarget.scrollTop)}
                className="-ml-2 -mr-3 min-h-0 flex-1 space-y-6 overflow-y-auto pb-12 pl-2 pr-3 [scrollbar-gutter:stable] [@container(max-width:859px)]:mx-0 [@container(max-width:859px)]:overflow-visible [@container(max-width:859px)]:px-0 [@container(max-width:859px)]:pb-0"
            >
                {home.programs.length === 0 ? (
                    <Notice>
                        <h2 className="font-medium">{t("home.emptyTitle")}</h2>
                        <p className="mt-1">{t("home.emptyBody")}</p>
                    </Notice>
                ) : waitingForTracker ? (
                    <p role="status" className="text-ink-3 flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                        {t("tracker.loading")}
                    </p>
                ) : visible.length === 0 ? (
                    <Notice>
                        <h2 className="font-medium">{t("discovery.noResultsTitle")}</h2>
                        <p className="mt-1">{t("discovery.noResultsBody")}</p>
                    </Notice>
                ) : (
                    <>
                        <RecommendedPrograms
                            views={recommended}
                            details={home.details}
                            hrefFor={hrefFor}
                            trackedFor={trackedFor}
                            deadlineFor={deadlineFor}
                            today={today}
                        />
                        <section className="space-y-2">
                            {recommended.length > 0 && (
                                <h2 className="text-ink text-sm font-semibold">
                                    {t("recommended.allPrograms")}
                                </h2>
                            )}
                            <div className="-mx-2 space-y-0.5">
                                {visible.map(item => (
                                    <ProgramRow
                                        key={item.program.id}
                                        view={item}
                                        details={home.details[item.program.id]}
                                        tracked={trackedFor(item.program.id)}
                                        deadline={deadlineFor(item)}
                                        today={today}
                                        href={hrefFor(item.program.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
}

/** One figure in the header; a figure that is also a filter toggles it. */
function Stat({
    label,
    value,
    tone,
    active = false,
    onSelect,
}: {
    label: string;
    value: string;
    tone?: FitBand;
    active?: boolean;
    onSelect?: () => void;
}) {
    const body = (
        <>
            <span
                className={cn(
                    "font-semibold tabular-nums",
                    tone ? FIT_BAND_TEXT[tone] : "text-ink"
                )}
            >
                {value}
            </span>
            <span className={active ? "text-brand-ink" : "text-ink-3"}>{label}</span>
        </>
    );
    return (
        <li className="flex">
            {onSelect ? (
                <button
                    type="button"
                    aria-pressed={active}
                    onClick={onSelect}
                    className={cn(
                        "focus-visible:ring-brand/50 -mx-2 inline-flex items-baseline gap-1.5 rounded-md px-2 py-0.5 outline-none transition-colors focus-visible:ring-2",
                        active ? "bg-brand-soft" : "hover:bg-panel-2"
                    )}
                >
                    {body}
                </button>
            ) : (
                <span className="inline-flex items-baseline gap-1.5 py-0.5">{body}</span>
            )}
        </li>
    );
}
