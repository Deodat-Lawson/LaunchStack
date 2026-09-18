"use client";

import { Suspense, useEffect, useState } from "react";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { Toaster } from "~/components/ui/sonner";
import { ProspectsShell } from "~/app/employer/tools/growth/prospects/_components/ProspectsShell";
import { ProspectsProvider } from "~/app/employer/tools/growth/prospects/_lib/context";
import { CompaniesScreen } from "~/app/employer/tools/growth/prospects/_screens/CompaniesScreen";
import { CompanyScreen } from "~/app/employer/tools/growth/prospects/_screens/CompanyScreen";
import { DealsScreen } from "~/app/employer/tools/growth/prospects/_screens/DealsScreen";
import { HomeScreen } from "~/app/employer/tools/growth/prospects/_screens/HomeScreen";
import { PeopleScreen } from "~/app/employer/tools/growth/prospects/_screens/PeopleScreen";
import { RunsScreen } from "~/app/employer/tools/growth/prospects/_screens/RunsScreen";
import { SegmentScreen } from "~/app/employer/tools/growth/prospects/_screens/SegmentScreen";
import { SourcesScreen } from "~/app/employer/tools/growth/prospects/_screens/SourcesScreen";

import { resetSimulator, simulate } from "./simulator";

/**
 * Mounts the real Prospects screens with `/api/prospects/*` answered by the
 * in-memory simulator. Installed at module scope so the first fetch the
 * shell makes is already intercepted. `?reset=1` clears the simulator.
 */
let stubbed = false;
function stubProspectsApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const simulated = await simulate(url, init);
        return simulated ?? real(input, init);
    };
}

stubProspectsApi();

function Screen({ slug }: { slug: string[] }) {
    const [head, second] = slug;
    switch (head) {
        case undefined:
            return <HomeScreen />;
        case "companies":
            return second ? (
                <CompanyScreen id={second} />
            ) : (
                <Suspense fallback={null}>
                    <CompaniesScreen />
                </Suspense>
            );
        case "people":
            return <PeopleScreen />;
        case "deals":
            return <DealsScreen />;
        case "runs":
            return <RunsScreen />;
        case "segment":
            return <SegmentScreen />;
        case "sources":
            return <SourcesScreen />;
        default:
            return (
                <p className="text-ink-2 text-sm">
                    No such screen in the harness: /{slug.join("/")}
                </p>
            );
    }
}

export function ProspectsPreview({ slug }: { slug: string[] }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("reset") === "1") resetSimulator();
        setReady(true);
    }, []);
    if (!ready) return null;
    return (
        <div data-preview="prospects" className="flex min-h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Find companies runs a simulated
                20-second run. Add <span className="font-mono">?reset=1</span> to start over.
            </div>
            <ToolsStudioShell>
                <ProspectsProvider basePath="/dev/prospects">
                    <ProspectsShell>
                        <Screen slug={slug} />
                    </ProspectsShell>
                </ProspectsProvider>
            </ToolsStudioShell>
            <Toaster richColors position="top-right" />
        </div>
    );
}
