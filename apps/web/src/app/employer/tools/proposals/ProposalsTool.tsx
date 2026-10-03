"use client";

import { BookMarked, Building2, FileText, Home, Landmark, Loader2 } from "lucide-react";

import { ToolFrame, ToolNotFound, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";

import { ProposalRunSheet } from "./_components/ProposalRunSheet";
import { ProposalsMark } from "./_components/ProposalsMark";
import { ProposalsProvider, runIsLive, useProposals } from "./_lib/context";
import { PROPOSALS_ROOTS, proposalsScreenFor, type ProposalsScreen } from "./_lib/screens";
import { ApplicationScreen } from "./_screens/ApplicationScreen";
import { ApplicationsScreen } from "./_screens/ApplicationsScreen";
import { FundersScreen } from "./_screens/FundersScreen";
import { HomeScreen } from "./_screens/HomeScreen";
import { LibraryScreen } from "./_screens/LibraryScreen";
import { ProfileScreen } from "./_screens/ProfileScreen";
import { RUN_KIND_LABEL } from "./api";

/**
 * Proposals: a writing app. Find the funders that fit, turn their call into
 * a checklist, draft every answer from what the workspace's sources prove,
 * review, submit.
 *
 * It is a tab of the workspace, beside the chat and the sources: picking it
 * never leaves `/employer/documents`, so the person's other tabs and split
 * stay as they were. Its screens are app-relative paths inside the tab
 * ("/write/12"); the old `/employer/tools/proposals/...` pages redirect here.
 * The workspace mounts it with `host`; the dev harness mounts it bare.
 */
export function ProposalsTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="proposals" roots={PROPOSALS_ROOTS} host={host}>
            <ProposalsProvider basePath="">
                <ProposalsFrame />
            </ProposalsProvider>
        </ToolNavProvider>
    );
}

/** The rail's one line about a run: what it is doing, with the current step. */
function RunIndicator() {
    const { activeRun, openRunSheet } = useProposals();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    return (
        <button
            type="button"
            onClick={() => openRunSheet()}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none focus-visible:ring-[3px]"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
                {RUN_KIND_LABEL[activeRun.kind]}
                {current ? ` · ${current.label.toLowerCase()}` : ""}
            </span>
        </button>
    );
}

/**
 * One rail for the writing app. Write is the work; Funders is where it
 * starts; Profile and Library are what every draft draws on. The run sheet
 * is the frame's overlay, so any screen's Draft or Find funders opens it
 * over this tab only.
 */
function ProposalsFrame() {
    const path = useToolPathname();
    const { counts, activeRun } = useProposals();
    const groups: ToolNavGroup[] = [
        {
            id: "proposals",
            items: [
                { to: "/", label: "Home", icon: Home, exact: true },
                { to: "/write", label: "Write", icon: FileText, count: counts?.applications },
                { to: "/funders", label: "Funders", icon: Landmark, count: counts?.funders },
                { to: "/profile", label: "Profile", icon: Building2 },
                { to: "/library", label: "Library", icon: BookMarked, count: counts?.library },
            ],
            // Only while a run is live: the folded bar makes room for any
            // footer it is given, even one that renders nothing.
            footer: runIsLive(activeRun) ? <RunIndicator /> : undefined,
        },
    ];
    return (
        <ToolFrame
            title="Proposals"
            mark={<ProposalsMark />}
            groups={groups}
            railFooter="Drafts cite your Sources. Approved answers go to the Library. A finished proposal can be exported back into Sources."
            overlay={<ProposalRunSheet />}
        >
            <Screen screen={proposalsScreenFor(path)} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: ProposalsScreen }) {
    switch (screen.screen) {
        case "home":
            return <HomeScreen />;
        case "applications":
            return <ApplicationsScreen />;
        case "application":
            // Keyed so another proposal starts fresh (its tab, its selected
            // section), as a new page did when each one was a route.
            return <ApplicationScreen key={screen.id} id={screen.id} />;
        case "funders":
            return <FundersScreen />;
        case "profile":
            return <ProfileScreen />;
        case "library":
            return <LibraryScreen />;
        case "not-found":
            return <ToolNotFound home="/" homeLabel="Proposals home" />;
    }
}
