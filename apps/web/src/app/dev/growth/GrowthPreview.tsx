"use client";

import { Suspense, useEffect, useState } from "react";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { Toaster } from "~/components/ui/sonner";
import { GrowthShell } from "~/app/employer/tools/growth/_components/GrowthShell";
import { AccountsScreen } from "~/app/employer/tools/growth/brand/_screens/AccountsScreen";
import { CalendarScreen } from "~/app/employer/tools/growth/brand/_screens/CalendarScreen";
import { CampaignsScreen } from "~/app/employer/tools/growth/brand/_screens/CampaignsScreen";
import { ComposeScreen } from "~/app/employer/tools/growth/brand/_screens/ComposeScreen";
import { OverviewScreen } from "~/app/employer/tools/growth/brand/_screens/OverviewScreen";
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
 * Mounts the real Growth screens with `/api/prospects/*` and `/api/brand/*`
 * answered by the in-memory simulator. Installed at module scope so the
 * first fetch the shell makes is already intercepted. `?reset=1` clears it.
 */
let stubbed = false;
function stubApi() {
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

stubApi();

function BrandScreen({ slug }: { slug: string[] }) {
    switch (slug[0]) {
        case undefined:
            return <OverviewScreen />;
        case "compose":
            return <ComposeScreen />;
        case "calendar":
            return <CalendarScreen />;
        case "campaigns":
            return <CampaignsScreen />;
        case "accounts":
            return <AccountsScreen />;
        default:
            return <Missing slug={["brand", ...slug]} />;
    }
}

function ProspectsScreen({ slug }: { slug: string[] }) {
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
            return <Missing slug={["prospects", ...slug]} />;
    }
}

function Missing({ slug }: { slug: string[] }) {
    return <p className="text-ink-2 text-sm">No such screen in the harness: /{slug.join("/")}</p>;
}

function Screen({ slug }: { slug: string[] }) {
    const [area, ...rest] = slug;
    if (area === undefined || area === "brand") return <BrandScreen slug={rest} />;
    if (area === "prospects") return <ProspectsScreen slug={rest} />;
    return <Missing slug={slug} />;
}

export function GrowthPreview({ slug }: { slug: string[] }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("reset") === "1") resetSimulator();
        setReady(true);
    }, []);
    if (!ready) return null;
    return (
        <div data-preview="growth" className="flex min-h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Find companies runs a simulated
                20-second run; Brand posts publish in memory. Add{" "}
                <span className="font-mono">?reset=1</span> to start over.
            </div>
            <ToolsStudioShell>
                <ProspectsProvider basePath="/dev/growth/prospects">
                    <GrowthShell>
                        <Screen slug={slug} />
                    </GrowthShell>
                </ProspectsProvider>
            </ToolsStudioShell>
            <Toaster richColors position="top-right" />
        </div>
    );
}
