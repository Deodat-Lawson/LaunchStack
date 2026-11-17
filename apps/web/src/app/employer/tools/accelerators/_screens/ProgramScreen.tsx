"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { useToolSearchParams } from "~/components/tool-app/nav";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

import { FitPanel } from "../_components/FitPanel";
import {
    ApplyingTab,
    DealTab,
    OverviewTab,
    ProgramHero,
} from "../_components/ProgramDetailsSections";
import { FitStatus } from "../_components/ProgramFacts";
import { SimilarCompanies } from "../_components/SimilarCompanies";
import { TrackerControls } from "../_components/TrackerControls";
import { useAccelerators } from "../_lib/context";
import { useTracker } from "../_lib/tracker";
import { nextDeadline } from "../_lib/vision-filters";

const TAB_TRIGGER =
    "data-[state=active]:border-brand dark:data-[state=active]:border-brand data-[state=active]:text-ink text-ink-3 h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-2.5 pt-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent";

/**
 * Read top to bottom: who the Program is and its four deciding facts, then
 * details by topic, with fit beside them and your application last.
 *
 * In a tab 860px or wider the screen fills the tab's height: the header, the
 * tab names and the fit column stay put and only the open topic scrolls (the
 * fit column too, when it is taller than the tab). Narrower, the columns stack
 * and the screen scrolls as one.
 */
export function ProgramScreen({ id }: { id: string }) {
    const t = useTranslations("accelerators");
    const searchParams = useToolSearchParams();
    const query = searchParams.toString();
    const programsHref = query ? `/programs?${query}` : "/programs";
    const { home } = useAccelerators();
    const { opportunities } = useTracker();
    const [tab, setTab] = useState("overview");
    const scroller = useRef<HTMLDivElement | null>(null);
    const view = home?.programs.find(item => item.program.id === id);
    if (!home || !view) return <ToolNotFound home={programsHref} homeLabel={t("tool.programs")} />;
    const program = view.program;
    const details = home.details[program.id];
    const today = new Date().toISOString().slice(0, 10);
    const tracked = (opportunities ?? [])
        .filter(item => item.programId === program.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const mobileScore = <FitStatus view={view} ring />;
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6">
            <div className="shrink-0 space-y-4">
                <Button asChild variant="ghost" size="sm" className="-ml-2">
                    <ToolLink href={programsHref}>
                        <ArrowLeft className="size-3.5" />
                        {t("common.backPrograms")}
                    </ToolLink>
                </Button>
                <ProgramHero
                    view={view}
                    details={details}
                    deadline={nextDeadline(program, home.details, today)}
                    today={today}
                    tracked={tracked}
                    mobileScore={mobileScore}
                />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,18rem)] grid-rows-[minmax(0,1fr)] gap-10 [@container(max-width:859px)]:grid-cols-1 [@container(max-width:859px)]:grid-rows-none">
                <Tabs
                    value={tab}
                    onValueChange={next => {
                        setTab(next);
                        // A topic opens at its top, not where the last one was left.
                        scroller.current?.scrollTo({ top: 0 });
                    }}
                    className="min-h-0 min-w-0 gap-0"
                >
                    <TabsList className="border-line h-auto w-full shrink-0 justify-start gap-5 overflow-x-auto rounded-none border-b bg-transparent p-0">
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
                    <div
                        ref={scroller}
                        className="-ml-2 -mr-3 min-h-0 flex-1 overflow-y-auto pb-12 pl-2 pr-3 pt-5 [scrollbar-gutter:stable] [@container(max-width:859px)]:mx-0 [@container(max-width:859px)]:overflow-visible [@container(max-width:859px)]:px-0 [@container(max-width:859px)]:pb-0"
                    >
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
                    </div>
                </Tabs>
                <aside
                    aria-label={t("program.sidebar")}
                    className="divide-line -mx-2 min-h-0 min-w-0 space-y-5 divide-y overflow-y-auto px-2 pb-12 [&>*:not(:first-child)]:pt-5 [@container(max-width:859px)]:overflow-visible [@container(max-width:859px)]:pb-0"
                >
                    <FitPanel view={view} />
                    <section className="space-y-3">
                        <h2 className="text-ink text-sm font-semibold">
                            {t("tracker.panelTitle")}
                        </h2>
                        <TrackerControls
                            programId={program.id}
                            cycles={program.cycles}
                            canEdit={home.canEdit}
                        />
                    </section>
                </aside>
            </div>
        </div>
    );
}
