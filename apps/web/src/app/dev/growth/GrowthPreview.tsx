"use client";

import { Suspense, useEffect, useState } from "react";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { Toaster } from "~/components/ui/sonner";
import { GrowthLanding } from "~/app/employer/tools/growth/_screens/GrowthLanding";
import { BrandWorkspace } from "~/app/employer/tools/growth/brand/_screens/BrandWorkspace";
import { CampaignsScreen } from "~/app/employer/tools/growth/brand/_screens/CampaignsScreen";
import { ProspectsProvider } from "~/app/employer/tools/growth/prospects/_lib/context";
import { ProspectsWorkspace } from "~/app/employer/tools/growth/prospects/_screens/ProspectsWorkspace";

import { resetSimulator, simulate } from "./simulator";

/**
 * Mounts the real Growth pages with `/api/prospects/*` and `/api/brand/*`
 * answered by the in-memory simulator. Installed at module scope so the
 * first fetch a page makes is already intercepted. `?reset=1` clears it.
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

function Missing({ slug }: { slug: string[] }) {
    return <p className="text-ink-2 p-6 text-sm">No such page in the harness: /{slug.join("/")}</p>;
}

function Screen({ slug }: { slug: string[] }) {
    const [area, ...rest] = slug;
    if (area === undefined) return <GrowthLanding />;
    if (area === "brand") {
        if (rest.length === 0) return <BrandWorkspace />;
        if (rest[0] === "campaigns") return <CampaignsScreen />;
        return <Missing slug={slug} />;
    }
    if (area === "prospects" && rest.length === 0) return <ProspectsWorkspace />;
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
                20-second run; Brand posts publish in memory; a credential ending in “-bad” is
                refused. Add <span className="font-mono">?reset=1</span> to start over.
            </div>
            <ToolsStudioShell>
                <ProspectsProvider basePath="/dev/growth/prospects">
                    <Suspense fallback={null}>
                        <Screen slug={slug} />
                    </Suspense>
                </ProspectsProvider>
            </ToolsStudioShell>
            <Toaster richColors position="top-right" />
        </div>
    );
}
