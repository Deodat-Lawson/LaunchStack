"use client";

import { CalendarCheck, ChartLine, Handshake, Inbox, LifeBuoy, ListChecks } from "lucide-react";
import { useMemo } from "react";

import { VantageMark } from "~/components/icons/vantage";
import { EmptyState } from "~/components/tools/EmptyState";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { ToolFrame, ToolNotFound, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { usePermissions } from "~/lib/use-permissions";

import { vantagePath } from "./_lib/paths";
import { VANTAGE_ROOTS, vantageScreenFor, type VantageScreen } from "./_lib/screens";
import { AgendaScreen } from "./_screens/AgendaScreen";
import { CommitmentsScreen } from "./_screens/CommitmentsScreen";
import { EvidenceScreen } from "./_screens/EvidenceScreen";
import { MetricsScreen } from "./_screens/MetricsScreen";
import { OverviewScreen } from "./_screens/OverviewScreen";
import { TriageScreen } from "./_screens/TriageScreen";

/**
 * Vantage, the evidence-backed weekly meeting loop, as a tab of the
 * workspace. It used to be its own route tree under `/employer/tools/vantage`
 * with a layout and a sidebar, so opening it closed every other tab; now the
 * workspace renders this, the tab keeps its own history, and the old URLs
 * redirect here (see `[[...slug]]/page.tsx`).
 */
export function VantageTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="vantage" roots={VANTAGE_ROOTS} host={host}>
            <VantageFrame />
        </ToolNavProvider>
    );
}

/**
 * The bar runs in the order the week does: the founder's screens first,
 * then capture. Triage sits apart under "Program": it is the administrator's
 * side of the same table and only reads what the founder chose to share.
 */
function railGroups(admin: boolean): ToolNavGroup[] {
    const groups: ToolNavGroup[] = [
        {
            id: "week",
            label: "The week",
            items: [
                { to: vantagePath(""), label: "This week", icon: CalendarCheck, exact: true },
                { to: vantagePath("/agenda"), label: "Agenda", icon: ListChecks },
                { to: vantagePath("/commitments"), label: "Commitments", icon: Handshake },
            ],
        },
        {
            id: "capture",
            label: "Capture",
            items: [
                { to: vantagePath("/evidence"), label: "Evidence", icon: Inbox },
                { to: vantagePath("/metrics"), label: "Metrics", icon: ChartLine },
            ],
        },
    ];
    if (admin) {
        groups.push({
            id: "program",
            label: "Program",
            items: [{ to: vantagePath("/program"), label: "Triage", icon: LifeBuoy }],
        });
    }
    return groups;
}

function VantageFrame() {
    const { path, search } = useToolNav();
    const { can, loaded } = usePermissions();
    const admin = can("settings.manage");
    const groups = useMemo(() => railGroups(admin), [admin]);
    const screen = vantageScreenFor(
        `${path}${search}`,
        admin ? "allowed" : loaded ? "denied" : "pending"
    );
    return (
        <ToolFrame title="Vantage" mark={<VantageMark size={15} tile />} groups={groups}>
            <Screen screen={screen} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: VantageScreen }) {
    switch (screen.kind) {
        case "overview":
            return <OverviewScreen />;
        case "agenda":
            return <AgendaScreen week={screen.week} />;
        case "commitments":
            return <CommitmentsScreen />;
        case "evidence":
            return <EvidenceScreen />;
        case "metrics":
            return <MetricsScreen />;
        case "triage":
            return <TriageScreen />;
        case "triage-pending":
            return <SkeletonRows rows={4} height={44} className="mx-auto max-w-[1100px]" />;
        case "triage-denied":
            return <TriageDenied />;
        case "not-found":
            return <ToolNotFound home="/" homeLabel="This week" />;
    }
}

/**
 * Triage for someone who cannot manage the workspace. The screen exists —
 * an administrator may well have sent the link — so "this screen does not
 * exist" would be untrue; say whose screen it is instead.
 */
function TriageDenied() {
    const { navigate } = useToolNav();
    return (
        <EmptyState
            className="mx-auto max-w-[1100px]"
            title="Triage is the program's view"
            body="It gathers what founders chose to share — requests for help, commitments that slipped, program deadlines — for the people who run the program. Opening it needs permission to manage this workspace's settings; an owner or admin can grant it."
            action={
                <Button size="sm" variant="outline" onClick={() => navigate(vantagePath(""))}>
                    Go to This week
                </Button>
            }
        />
    );
}
