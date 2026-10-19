"use client";

import { CalendarCheck, ChartLine, Handshake, Inbox, ListChecks } from "lucide-react";
import { useMemo } from "react";

import { VantageMark } from "~/components/icons/vantage";
import { EmptyState } from "~/components/tools/EmptyState";
import { ToolFrame, ToolNotFound, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";

import { vantagePath } from "./_lib/paths";
import { VANTAGE_ROOTS, vantageScreenFor, type VantageScreen } from "./_lib/screens";
import { AgendaScreen } from "./_screens/AgendaScreen";
import { CommitmentsScreen } from "./_screens/CommitmentsScreen";
import { EvidenceScreen } from "./_screens/EvidenceScreen";
import { MetricsScreen } from "./_screens/MetricsScreen";

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
 * then capture. Contract v1 is private; sharing and program triage are deferred.
 */
function screenGroups(): ToolNavGroup[] {
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
    return groups;
}

function VantageFrame() {
    const { path, search } = useToolNav();
    const groups = useMemo(() => screenGroups(), []);
    const screen = vantageScreenFor(`${path}${search}`);
    return (
        <ToolFrame title="Vantage" mark={<VantageMark size={15} tile />} groups={groups}>
            <Screen screen={screen} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: VantageScreen }) {
    const { searchParams } = useToolNav();
    const actionId = searchParams.get("action");
    switch (screen.kind) {
        case "overview":
            return <AgendaScreen />;
        case "agenda":
            return <AgendaScreen week={screen.week} />;
        case "commitments":
            return <CommitmentsScreen key={actionId ?? "all"} actionId={actionId} />;
        case "evidence":
            return <EvidenceScreen />;
        case "metrics":
            return <MetricsScreen />;
        case "triage":
        case "triage-pending":
        case "triage-denied":
            return (
                <EmptyState
                    title="Sharing is unavailable"
                    body="Program triage is not available for the private weekly review test workspace."
                />
            );
        case "not-found":
            return <ToolNotFound home="/" homeLabel="This week" />;
    }
}
