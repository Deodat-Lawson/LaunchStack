"use client";

import {
    AtSign,
    Building2,
    CalendarDays,
    ChartColumn,
    Database,
    Handshake,
    History,
    House,
    LayoutDashboard,
    Megaphone,
    MessagesSquare,
    SquarePen,
    Target,
    Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { ProspectsMark } from "~/components/icons/prospects";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Skeleton } from "~/components/ui/skeleton";
import { ToolFrame, ToolNotFound, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";

import { RunIndicator } from "./_components/RunIndicator";
import { SegmentSwitcher } from "./_components/SegmentSwitcher";
import { useGrowthPaths } from "./_lib/paths";
import { GROWTH_HOME, GROWTH_ROOTS, growthScreenFor, type GrowthScreen } from "./_lib/screens";
import { AccountsScreen } from "./brand/_screens/AccountsScreen";
import { AnalyticsScreen } from "./brand/_screens/AnalyticsScreen";
import { CalendarScreen } from "./brand/_screens/CalendarScreen";
import { CampaignsScreen } from "./brand/_screens/CampaignsScreen";
import { ComposeScreen } from "./brand/_screens/ComposeScreen";
import { EngagementScreen } from "./brand/_screens/EngagementScreen";
import { OverviewScreen } from "./brand/_screens/OverviewScreen";
import { RunSheet } from "./prospects/_components/RunSheet";
import { ProspectsProvider, useProspects } from "./prospects/_lib/context";
import { CompaniesScreen } from "./prospects/_screens/CompaniesScreen";
import { CompanyScreen } from "./prospects/_screens/CompanyScreen";
import { DealsScreen } from "./prospects/_screens/DealsScreen";
import { HomeScreen } from "./prospects/_screens/HomeScreen";
import { PeopleScreen } from "./prospects/_screens/PeopleScreen";
import { RunsScreen } from "./prospects/_screens/RunsScreen";
import { SegmentScreen } from "./prospects/_screens/SegmentScreen";
import { SourcesScreen } from "./prospects/_screens/SourcesScreen";

/**
 * Growth: one tool for making the company known (Brand) and finding the
 * companies that will buy (Prospects), as a tab of the workspace.
 *
 * It used to be its own route tree under `/employer/tools/growth`, so
 * opening it left the workspace and closed every other tab. Now the tab
 * keeps its own history of app-relative locations ("/prospects/companies",
 * "/brand/compose") and the old URLs redirect here. Design rules for the
 * screens are in ./DESIGN.md; the tab contract is
 * `components/tool-app/README.md`.
 */
export function GrowthTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="growth" roots={GROWTH_ROOTS} home={GROWTH_HOME} host={host}>
            <ProspectsProvider basePath="/prospects">
                <GrowthFrame />
            </ProspectsProvider>
        </ToolNavProvider>
    );
}

/**
 * One bar for the two halves of growing a company. Brand has no unit of
 * navigation beyond the week, so its group is plain screens; Prospects keeps
 * the segment switcher, since every screen there is about one segment. The
 * run sheet is the frame's overlay so any screen's "Find companies" can open
 * it, and it covers this tab only.
 */
function GrowthFrame() {
    const t = useTranslations("growth.tool");
    const path = useToolPathname();
    const groups = useGrowthGroups();
    return (
        <ToolFrame
            title={t("title")}
            mark={<ProspectsMark size={15} tile />}
            groups={groups}
            // A run belongs to the whole tool: its pill is in the bar on
            // Brand's screens too, so there is always a way back to it.
            status={<RunIndicator />}
            overlay={<RunSheet />}
        >
            {/* Keyed by path so a screen starts fresh on each visit, as it did
                when every screen was a page — one company's half-typed next
                step must not carry over to the next company. A query change
                (the Companies filters) keeps the screen and its focus. */}
            <GrowthScreenView key={path} screen={growthScreenFor(path)} />
        </ToolFrame>
    );
}

function useGrowthGroups(): ToolNavGroup[] {
    const t = useTranslations("growth.tool");
    const { segment } = useProspects();
    const paths = useGrowthPaths();
    const counts = segment?.counts;
    return [
        {
            id: "brand",
            label: t("groups.brand"),
            items: [
                {
                    to: paths.brand(""),
                    label: t("nav.overview"),
                    icon: LayoutDashboard,
                    exact: true,
                },
                { to: paths.brand("/compose"), label: t("nav.compose"), icon: SquarePen },
                { to: paths.brand("/calendar"), label: t("nav.calendar"), icon: CalendarDays },
                { to: paths.brand("/analytics"), label: t("nav.analytics"), icon: ChartColumn },
                {
                    to: paths.brand("/engagement"),
                    label: t("nav.engagement"),
                    icon: MessagesSquare,
                },
                { to: paths.brand("/campaigns"), label: t("nav.campaigns"), icon: Megaphone },
                { to: paths.brand("/accounts"), label: t("nav.accounts"), icon: AtSign },
            ],
        },
        {
            id: "prospects",
            label: t("groups.prospects"),
            toolbar: <SegmentSwitcher compact />,
            header: <SegmentSwitcher />,
            items: [
                { to: paths.prospects(""), label: t("nav.home"), icon: House, exact: true },
                {
                    to: paths.prospects("/companies"),
                    label: t("nav.companies"),
                    icon: Building2,
                    count: counts?.companies,
                },
                {
                    to: paths.prospects("/people"),
                    label: t("nav.people"),
                    icon: Users,
                    count: counts?.people,
                },
                {
                    to: paths.prospects("/deals"),
                    label: t("nav.deals"),
                    icon: Handshake,
                    count: counts?.deals,
                },
                { to: paths.prospects("/runs"), label: t("nav.runs"), icon: History },
                { to: paths.prospects("/segment"), label: t("nav.segment"), icon: Target },
                {
                    to: paths.prospects("/sources"),
                    label: t("nav.sources"),
                    icon: Database,
                    count: counts?.sources,
                },
            ],
        },
    ];
}

/** The element for a screen key; the path → key half lives in `_lib/screens.ts`. */
function GrowthScreenView({ screen }: { screen: GrowthScreen }) {
    const t = useTranslations("growth.tool");
    const { segmentId, segmentsLoading } = useProspects();
    // Every Prospects screen is about one segment. Until the segment list has
    // answered there is no segment to ask about, and a screen asked anyway
    // says "No companies in this segment yet" — on every reload of a restored
    // tab. Hold the screen at its skeleton instead.
    if (screen.key.startsWith("prospects-") && segmentsLoading && !segmentId) {
        return <ProspectsLoading />;
    }
    switch (screen.key) {
        case "brand-overview":
            return <OverviewScreen />;
        case "brand-compose":
            return <ComposeScreen />;
        case "brand-calendar":
            return <CalendarScreen />;
        case "brand-analytics":
            return <AnalyticsScreen />;
        case "brand-engagement":
            return <EngagementScreen />;
        case "brand-campaigns":
            return <CampaignsScreen />;
        case "brand-accounts":
            return <AccountsScreen />;
        case "prospects-home":
            return <HomeScreen />;
        case "prospects-companies":
            return <CompaniesScreen />;
        case "prospects-company":
            return <CompanyScreen id={screen.id} />;
        case "prospects-people":
            return <PeopleScreen />;
        case "prospects-deals":
            return <DealsScreen />;
        case "prospects-runs":
            return <RunsScreen />;
        case "prospects-segment":
            return <SegmentScreen />;
        case "prospects-sources":
            return <SourcesScreen />;
        case "not-found":
            return <ToolNotFound home={GROWTH_HOME} homeLabel={t("notFoundHome")} />;
    }
}

function ProspectsLoading() {
    const tc = useTranslations("common.a11y");
    return (
        <div className="flex flex-col gap-5" aria-busy="true" aria-label={tc("loading")}>
            <Skeleton className="h-8 w-56" />
            <SkeletonRows rows={8} />
        </div>
    );
}
