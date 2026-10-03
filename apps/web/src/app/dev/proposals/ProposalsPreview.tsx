"use client";

import { useEffect, useState } from "react";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { ProposalsShell } from "~/app/employer/tools/proposals/_components/ProposalsShell";
import { ProposalsProvider } from "~/app/employer/tools/proposals/_lib/context";
import { ApplicationScreen } from "~/app/employer/tools/proposals/_screens/ApplicationScreen";
import { ApplicationsScreen } from "~/app/employer/tools/proposals/_screens/ApplicationsScreen";
import { FundersScreen } from "~/app/employer/tools/proposals/_screens/FundersScreen";
import { HomeScreen } from "~/app/employer/tools/proposals/_screens/HomeScreen";
import { LibraryScreen } from "~/app/employer/tools/proposals/_screens/LibraryScreen";
import { ProfileScreen } from "~/app/employer/tools/proposals/_screens/ProfileScreen";
import { Toaster } from "~/components/ui/sonner";

import { resetProposalsSim, simulateProposals } from "./simulator";

/**
 * Mounts the real Proposals screens with `/api/proposals/*` answered by the
 * in-memory simulator. Installed at module scope so the first fetch the
 * shell makes is already intercepted. `?reset=1` clears it.
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const simulated = await simulateProposals(
            new URL(url, "http://proposals.local"),
            init,
            Date.now()
        );
        return simulated ?? real(input, init);
    };
}

stubApi();

function Screen({ slug }: { slug: string[] }) {
    const [head, second] = slug;
    switch (head) {
        case undefined:
            return <HomeScreen />;
        case "write":
            return second ? <ApplicationScreen id={second} /> : <ApplicationsScreen />;
        case "funders":
            return <FundersScreen />;
        case "profile":
            return <ProfileScreen />;
        case "library":
            return <LibraryScreen />;
        default:
            return (
                <p className="text-ink-2 text-sm">
                    No such screen in the harness: /{slug.join("/")}
                </p>
            );
    }
}

export function ProposalsPreview({ slug }: { slug: string[] }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("reset") === "1") resetProposalsSim();
        setReady(true);
    }, []);
    if (!ready) return null;
    return (
        <div data-preview="proposals" className="flex min-h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Runs finish in a few seconds and change
                what you see. Add <span className="font-mono">?reset=1</span> to start over.
            </div>
            <ToolsStudioShell>
                <ProposalsProvider basePath="/dev/proposals">
                    <ProposalsShell>
                        <Screen slug={slug} />
                    </ProposalsShell>
                </ProposalsProvider>
            </ToolsStudioShell>
            <Toaster richColors position="top-right" />
        </div>
    );
}
