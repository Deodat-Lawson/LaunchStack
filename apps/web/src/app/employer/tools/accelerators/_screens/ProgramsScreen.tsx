"use client";

import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import { useToolPathname, useToolRouter, useToolSearchParams } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useErrorText } from "~/lib/tools/errorText";

import { DiscoveryToolbar } from "../_components/DiscoveryToolbar";
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
    const format = useFormatter();
    const locale = useLocale();
    const errorText = useErrorText();
    const { home, runBusy, match, refresh } = useAccelerators();
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
        () => filterPrograms(ranked, { q, fit, minScore, intake }),
        [ranked, q, fit, minScore, intake]
    );
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [refreshing, setRefreshing] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    if (!home) return null;

    const visible = applyVisionFilters(catalogueVisible, vision, {
        demo: home.demo,
        tracker: opportunities ?? [],
        today,
    });
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
    const matchPrograms = async () => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setFailure(null);
        try {
            await match();
        } catch (error) {
            setFailure(error);
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    };
    const trackedFor = (programId: string) =>
        (opportunities ?? [])
            .filter(item => item.programId === programId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const waitingForTracker =
        opportunities === null && (vision.tracked !== "any" || vision.priority !== "any");

    return (
        <div className="min-w-0 space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl space-y-1.5">
                    <h1 className="display text-ink text-2xl tracking-tight">{t("home.title")}</h1>
                    <p className="text-ink-3 text-sm leading-relaxed">{t("home.description")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t("common.refresh")}
                                disabled={refreshing}
                                onClick={async () => {
                                    setRefreshing(true);
                                    try {
                                        await refresh();
                                    } catch {
                                        /* The frame renders load errors. */
                                    } finally {
                                        setRefreshing(false);
                                    }
                                }}
                            >
                                <RefreshCw
                                    className={
                                        refreshing ? "animate-spin motion-reduce:animate-none" : ""
                                    }
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.refresh")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span tabIndex={-1}>
                                <Button
                                    type="button"
                                    disabled={
                                        !home.canEdit ||
                                        !home.profileReady ||
                                        home.programs.length === 0 ||
                                        pending ||
                                        runBusy
                                    }
                                    onClick={matchPrograms}
                                >
                                    {pending ? (
                                        <Loader2 className="animate-spin motion-reduce:animate-none" />
                                    ) : (
                                        <Sparkles />
                                    )}
                                    {pending
                                        ? t("home.matching")
                                        : t("home.match", {
                                              credits: format.number(home.costs.match),
                                          })}
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                            {home.profileReady
                                ? t("home.matchHint", { count: home.matchCount })
                                : t("home.profileMissing")}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </header>

            {failure != null && (
                <p role="alert" className="text-danger text-sm">
                    {errorText(failure, t("common.actionFailed"))}
                </p>
            )}
            <DiscoveryToolbar
                catalogue={catalogue}
                vision={vision}
                resultCount={visible.length}
                totalCount={home.programs.length}
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
                <div className="space-y-2">
                    {visible.map(item => (
                        <ProgramRow
                            key={item.program.id}
                            view={item}
                            demo={home.demo}
                            tracked={trackedFor(item.program.id)}
                            deadline={nextDeadline(item.program, home.demo, today)}
                            today={today}
                            href={`${programPath(item.program.id)}${queryString ? `?${queryString}` : ""}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
