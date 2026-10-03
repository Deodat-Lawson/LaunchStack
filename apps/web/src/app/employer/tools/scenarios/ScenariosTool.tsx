"use client";

import { Plus, Waypoints } from "lucide-react";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";
import { SCENARIO_CAVEAT } from "~/lib/scenarios/types";

import { StatusPill } from "./_components/Bits";
import { ScenariosProvider, useScenarios } from "./_lib/context";
import {
    SCENARIOS_HOME,
    SCENARIOS_ROOTS,
    runPath,
    scenariosScreenFor,
    type ScenariosScreen,
} from "./_lib/screens";
import { ListScreen } from "./_screens/ListScreen";
import { NewScreen } from "./_screens/NewScreen";
import { RunScreen } from "./_screens/RunScreen";

/**
 * Scenarios, as a tab of the workspace: people built from the workspace's own
 * records react to a situation over several rounds of a simulated social
 * network, and the run reports what moved them. Two screens across the top
 * (the list and the form); a run opens from the list at "/runs/:id".
 */
export function ScenariosTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider
            toolId="scenarios"
            roots={SCENARIOS_ROOTS}
            home={SCENARIOS_HOME}
            host={host}
        >
            <ScenariosProvider>
                <ScenariosFrame />
            </ScenariosProvider>
        </ToolNavProvider>
    );
}

const GROUPS: ToolNavGroup[] = [
    {
        id: "scenarios",
        items: [
            { to: "/runs", label: "Scenarios", icon: Waypoints },
            { to: "/new", label: "New", icon: Plus, exact: true },
        ],
    },
];

function ScenariosFrame() {
    const { path, search } = useToolNav();
    const { liveRun } = useScenarios();
    const screen = scenariosScreenFor(`${path}${search}`);
    const showingLive = screen.kind === "run" && screen.id === liveRun?.id;
    return (
        <ToolFrame
            title="Scenarios"
            mark={<ToolMark icon={Waypoints} />}
            groups={GROUPS}
            about={
                <>
                    People built from your records react to a situation over several rounds: what
                    they say, who changes their mind and why. {SCENARIO_CAVEAT}
                </>
            }
            status={
                liveRun && !showingLive ? (
                    <ToolLink
                        href={runPath(liveRun.id)}
                        className="hover:bg-panel-2 focus-visible:ring-brand/50 inline-flex items-center rounded-md px-2 py-1 outline-none focus-visible:ring-2"
                        aria-label={`${liveRun.title}: in progress`}
                    >
                        <StatusPill run={liveRun} />
                    </ToolLink>
                ) : undefined
            }
        >
            <Screen screen={screen} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: ScenariosScreen }) {
    switch (screen.kind) {
        case "list":
            return <ListScreen />;
        case "new":
            return <NewScreen />;
        case "run":
            return <RunScreen key={screen.id} screen={screen} />;
        case "not-found":
            return <ToolNotFound home="/runs" homeLabel="Scenarios" />;
    }
}
