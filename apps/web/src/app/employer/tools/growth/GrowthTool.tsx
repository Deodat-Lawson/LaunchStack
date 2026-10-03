"use client";

import {
    AtSign,
    Building2,
    CalendarDays,
    Database,
    Handshake,
    History,
    House,
    LayoutDashboard,
    Megaphone,
    SquarePen,
    Target,
    Users,
} from "lucide-react";

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
import { CalendarScreen } from "./brand/_screens/CalendarScreen";
import { CampaignsScreen } from "./brand/_screens/CampaignsScreen";
import { ComposeScreen } from "./brand/_screens/ComposeScreen";
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
    const path = useToolPathname();
    const groups = useGrowthGroups();
    return (
        <ToolFrame
            title="Growth"
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
    const { segment } = useProspects();
    const paths = useGrowthPaths();
    const counts = segment?.counts;
    return [
        {
            id: "brand",
            label: "Brand",
            items: [
                { to: paths.brand(""), label: "Overview", icon: LayoutDashboard, exact: true },
                { to: paths.brand("/compose"), label: "Compose", icon: SquarePen },
                { to: paths.brand("/calendar"), label: "Calendar", icon: CalendarDays },
                { to: paths.brand("/campaigns"), label: "Campaigns", icon: Megaphone },
                { to: paths.brand("/accounts"), label: "Accounts", icon: AtSign },
            ],
        },
        {
            id: "prospects",
            label: "Prospects",
            toolbar: <SegmentSwitcher compact />,
            header: <SegmentSwitcher />,
            items: [
                { to: paths.prospects(""), label: "Home", icon: House, exact: true },
                {
                    to: paths.prospects("/companies"),
                    label: "Companies",
                    icon: Building2,
                    count: counts?.companies,
                },
                {
                    to: paths.prospects("/people"),
                    label: "People",
                    icon: Users,
                    count: counts?.people,
                },
                {
                    to: paths.prospects("/deals"),
                    label: "Deals",
                    icon: Handshake,
                    count: counts?.deals,
                },
                { to: paths.prospects("/runs"), label: "Runs", icon: History },
                { to: paths.prospects("/segment"), label: "Segment", icon: Target },
                {
                    to: paths.prospects("/sources"),
                    label: "Sources",
                    icon: Database,
                    count: counts?.sources,
                },
            ],
        },
    ];
}

/** The element for a screen key; the path → key half lives in `_lib/screens.ts`. */
function GrowthScreenView({ screen }: { screen: GrowthScreen }) {
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
            return <ToolNotFound home={GROWTH_HOME} homeLabel="Brand overview" />;
    }
}

function ProspectsLoading() {
    return (
        <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-8 w-56" />
            <SkeletonRows rows={8} />
        </div>
    );
}
