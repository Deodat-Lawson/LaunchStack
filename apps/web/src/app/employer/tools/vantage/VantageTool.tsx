"use client";

import { CalendarCheck, ChartLine, Handshake, Inbox, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

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
import { ContextDemoScreen, ContextNativeReview } from "./_screens/ContextDemoScreen";

/**
 * Vantage, the evidence-backed weekly meeting loop, as a tab of the
 * workspace. It used to be its own route tree under `/employer/tools/vantage`
 * with a layout and a sidebar, so opening it closed every other tab; now the
 * workspace renders this, the tab keeps its own history, and the old URLs
 * redirect here (see `[[...slug]]/page.tsx`).
 */
export function VantageTool({
    host,
    contextDemoEnabled = false,
}: {
    host?: ToolHost;
    /** Only supplied by the server-gated local demonstration page. */
    contextDemoEnabled?: boolean;
}) {
    return (
        <ToolNavProvider
            toolId="vantage"
            roots={contextDemoEnabled ? [...VANTAGE_ROOTS, "context-demo"] : VANTAGE_ROOTS}
            host={host}
        >
            <VantageFrame contextDemoEnabled={contextDemoEnabled} />
        </ToolNavProvider>
    );
}

/**
 * The v1 navigation names the product loop. The older paths remain valid for
 * saved links and week queries, but the primary bar stays deliberately small.
 */
function screenGroups(contextDemoEnabled: boolean): ToolNavGroup[] {
    const groups: ToolNavGroup[] = [
        {
            id: "vantage-loop",
            label: "Vantage",
            items: [
                ...(contextDemoEnabled
                    ? [{ to: "/context-demo", label: "Context-Aware Demo", icon: Sparkles }]
                    : []),
                { to: vantagePath(""), label: "Weekly Review", icon: CalendarCheck, exact: true },
                { to: vantagePath("/commitments"), label: "Weekly Actions", icon: Handshake },
                { to: vantagePath("/evidence"), label: "Evidence", icon: Inbox },
                { to: vantagePath("/metrics"), label: "Metrics", icon: ChartLine },
            ],
        },
    ];
    return groups;
}

function VantageFrame({ contextDemoEnabled }: { contextDemoEnabled: boolean }) {
    const { path, search } = useToolNav();
    const [demoWeek, setDemoWeek] = useState<string | undefined>();
    const groups = useMemo(() => screenGroups(contextDemoEnabled), [contextDemoEnabled]);
    const screen = vantageScreenFor(`${path}${search}`);
    return (
        <ToolFrame title="Vantage" mark={<VantageMark size={15} tile />} groups={groups}>
            {contextDemoEnabled && path === "/context-demo" ? (
                <ContextDemoScreen onSelectedWeek={setDemoWeek} />
            ) : (
                <Screen
                    screen={screen}
                    contextDemoEnabled={contextDemoEnabled}
                    demoWeek={demoWeek}
                />
            )}
        </ToolFrame>
    );
}

function Screen({
    screen,
    demoWeek,
    contextDemoEnabled,
}: {
    screen: VantageScreen;
    demoWeek?: string;
    contextDemoEnabled: boolean;
}) {
    const { searchParams } = useToolNav();
    const actionId = searchParams.get("action");
    switch (screen.kind) {
        case "overview":
            return contextDemoEnabled ? (
                <ContextNativeReview week={searchParams.get("week") ?? demoWeek} />
            ) : (
                <AgendaScreen />
            );
        case "agenda":
            return contextDemoEnabled ? (
                <ContextNativeReview week={screen.week ?? demoWeek} />
            ) : (
                <AgendaScreen week={screen.week} />
            );
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
