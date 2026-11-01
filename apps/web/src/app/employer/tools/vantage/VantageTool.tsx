"use client";

import { CalendarCheck, ChartLine, Handshake, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { ToolLink } from "~/components/tool-app/ToolLink";
import ui from "./_screens/unified-review.module.css";

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
                {
                    to: contextDemoEnabled ? "/" : vantagePath(""),
                    label: "Weekly Review",
                    icon: CalendarCheck,
                    exact: true,
                },
                { to: vantagePath("/commitments"), label: "Actions", icon: Handshake },
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
    const reviewPath = path === "/context-demo" || path === "/agenda";
    const groups = useMemo(
        () =>
            screenGroups(contextDemoEnabled).map(group => ({
                ...group,
                items: group.items.map(item =>
                    item.label === "Weekly Review" && contextDemoEnabled && reviewPath
                        ? { ...item, to: path }
                        : item
                ),
            })),
        [contextDemoEnabled, reviewPath, path]
    );
    const screen = vantageScreenFor(`${path}${search}`);
    const reviewScreen =
        screen.kind === "overview" || screen.kind === "agenda" || path === "/context-demo";
    const alternative = contextDemoEnabled && new URLSearchParams(search).get("report") === "rules";
    const primaryParams = new URLSearchParams(search);
    primaryParams.delete("report");
    return (
        <div className={ui.frame}>
            <ToolFrame
                title="Vantage"
                mark={<VantageMark size={15} tile />}
                groups={groups}
                contentClassName={ui.frameContent}
            >
                {contextDemoEnabled && reviewScreen ? (
                    alternative ? (
                        <div className={ui.alternative}>
                            <div className={ui.alternativeBanner}>
                                <span>
                                    Alternative saved report - kept separate from your weekly brief
                                </span>
                                <ToolLink href={`/?${primaryParams.toString()}`}>
                                    Back to Weekly Review
                                </ToolLink>
                            </div>
                            <ContextNativeReview
                                week={new URLSearchParams(search).get("week") ?? demoWeek}
                            />
                        </div>
                    ) : (
                        <ContextDemoScreen onSelectedWeek={setDemoWeek} />
                    )
                ) : (
                    <Screen
                        screen={screen}
                        contextDemoEnabled={contextDemoEnabled}
                        demoWeek={demoWeek}
                    />
                )}
                {contextDemoEnabled && (
                    <nav className={ui.mobileNav} aria-label="Vantage navigation">
                        {[
                            { to: "/", label: "Review", active: reviewScreen },
                            {
                                to: "/commitments",
                                label: "Actions",
                                active: screen.kind === "commitments",
                            },
                            {
                                to: "/evidence",
                                label: "Evidence",
                                active: screen.kind === "evidence",
                            },
                            { to: "/metrics", label: "Metrics", active: screen.kind === "metrics" },
                        ].map(item => (
                            <ToolLink
                                key={item.to}
                                href={item.to}
                                aria-current={item.active ? "page" : undefined}
                            >
                                {item.label}
                            </ToolLink>
                        ))}
                    </nav>
                )}
            </ToolFrame>
        </div>
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
