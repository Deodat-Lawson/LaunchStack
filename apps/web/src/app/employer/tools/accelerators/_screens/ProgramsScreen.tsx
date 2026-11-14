"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { useToolPathname, useToolRouter, useToolSearchParams } from "~/components/tool-app/nav";

import { DiscoveryToolbar } from "../_components/DiscoveryToolbar";
import { ScoreControl } from "../_components/ScoreControl";
import { Notice } from "../_components/ProgramFacts";
import { ProgramRow } from "../_components/ProgramRow";
import { useAccelerators } from "../_lib/context";
import {
    DEFAULT_DISCOVERY_FILTERS,
    filterPrograms,
    rankPrograms,
    readDiscoveryFilters,
    updateDiscoveryParams,
    type DiscoveryFilters,
} from "../_lib/discovery";
import { programPath } from "../_lib/screens";
import { useTracker } from "../_lib/tracker";
import {
    DEFAULT_VISION_FILTERS,
    applyVisionFilters,
    nextDeadline,
    readVisionFilters,
    updateVisionParams,
    type VisionFilters,
} from "../_lib/vision-filters";

export function ProgramsScreen() {
    const t = useTranslations("accelerators");
    const locale = useLocale();
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

    return (
        <div className="min-w-0 space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="display text-ink text-2xl tracking-tight">{t("home.title")}</h1>
                <ScoreControl visible={visible} />
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
                <div className="-mx-2 space-y-0.5">
                    {visible.map(item => (
                        <ProgramRow
                            key={item.program.id}
                            view={item}
                            details={home.details[item.program.id]}
                            tracked={trackedFor(item.program.id)}
                            deadline={nextDeadline(item.program, home.details, today)}
                            today={today}
                            href={`${programPath(item.program.id)}${queryString ? `?${queryString}` : ""}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
