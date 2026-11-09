"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { useToolSearchParams } from "~/components/tool-app/nav";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

import { FitPanel } from "../_components/FitPanel";
import {
    ApplyingTab,
    DealTab,
    OverviewTab,
    ProgramHero,
} from "../_components/ProgramDetailsSections";
import { FitStatus, ScoreRing } from "../_components/ProgramFacts";
import { SimilarCompanies } from "../_components/SimilarCompanies";
import { TrackerControls } from "../_components/TrackerControls";
import { useAccelerators } from "../_lib/context";
import { summarizeFit } from "../_lib/demo";
import { useTracker } from "../_lib/tracker";
import { nextDeadline } from "../_lib/vision-filters";

const TAB_TRIGGER =
    "data-[state=active]:border-brand dark:data-[state=active]:border-brand data-[state=active]:text-ink text-ink-3 h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-2.5 pt-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent";

/**
 * Read top to bottom: who the Program is and its four deciding facts, then
 * details by topic, with fit beside them and your application last.
 */
export function ProgramScreen({ id }: { id: string }) {
    const t = useTranslations("accelerators");
    const searchParams = useToolSearchParams();
    const query = searchParams.toString();
    const programsHref = query ? `/programs?${query}` : "/programs";
    const { home } = useAccelerators();
    const { opportunities } = useTracker();
    const view = home?.programs.find(item => item.program.id === id);
    if (!home || !view) return <ToolNotFound home={programsHref} homeLabel={t("tool.programs")} />;
    const program = view.program;
    const details = home.demo.details[program.id];
    const illustrative = home.demo.fits[program.id];
    const today = new Date().toISOString().slice(0, 10);
    const tracked = (opportunities ?? [])
        .filter(item => item.programId === program.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const overall = illustrative ? summarizeFit(illustrative).overall : null;
    const mobileScore = illustrative ? (
        <ScoreRing
            score={overall}
            label={
                overall === null
                    ? t("dimensions.insufficient")
                    : t("dimensions.overall", { score: overall })
            }
        />
    ) : (
        <FitStatus view={view} ring />
    );
    return (
        <div className="space-y-5">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
                <ToolLink href={programsHref}>
                    <ArrowLeft className="size-3.5" />
                    {t("common.backPrograms")}
                </ToolLink>
            </Button>
            <ProgramHero
                view={view}
                details={details}
                deadline={nextDeadline(program, home.demo, today)}
                today={today}
                tracked={tracked}
                mobileScore={mobileScore}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,20rem)] items-start gap-6 [@container(max-width:859px)]:grid-cols-1">
                <Card className="border-line min-w-0 gap-0 py-0">
                    <CardContent className="p-5">
                        <Tabs defaultValue="overview" className="gap-5">
                            <TabsList className="border-line h-auto w-full justify-start gap-5 overflow-x-auto rounded-none border-b bg-transparent p-0">
                                <TabsTrigger value="overview" className={TAB_TRIGGER}>
                                    {t("program.tabs.overview")}
                                </TabsTrigger>
                                <TabsTrigger value="deal" className={TAB_TRIGGER}>
                                    {t("program.tabs.deal")}
                                </TabsTrigger>
                                <TabsTrigger value="applying" className={TAB_TRIGGER}>
                                    {t("program.tabs.applying")}
                                </TabsTrigger>
                                <TabsTrigger value="similar" className={TAB_TRIGGER}>
                                    {t("program.tabs.similar")}
                                </TabsTrigger>
                            </TabsList>
                            <TabsContent value="overview">
                                <OverviewTab view={view} details={details} />
                            </TabsContent>
                            <TabsContent value="deal">
                                <DealTab details={details} />
                            </TabsContent>
                            <TabsContent value="applying">
                                <ApplyingTab view={view} details={details} today={today} />
                            </TabsContent>
                            <TabsContent value="similar">
                                <SimilarCompanies programId={program.id} />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
                <aside
                    aria-label={t("program.sidebar")}
                    className="min-w-0 space-y-4 self-start"
                >
                    <FitPanel view={view} illustrative={illustrative} />
                    <Card className="border-line gap-0 py-0">
                        <CardContent className="space-y-3 p-5">
                            <h2 className="text-ink text-sm font-semibold">
                                {t("tracker.panelTitle")}
                            </h2>
                            <TrackerControls
                                programId={program.id}
                                cycles={program.cycles}
                                canEdit={home.canEdit}
                            />
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    );
}
