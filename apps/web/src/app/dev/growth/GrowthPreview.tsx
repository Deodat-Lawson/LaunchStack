"use client";

import { useEffect, useMemo, useState } from "react";

import { GrowthTool } from "~/app/employer/tools/growth/GrowthTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { resetSimulator, simulate } from "./simulator";

/**
 * Mounts the real Growth tool — the same `GrowthTool` the workspace puts in
 * a tab — with `/api/prospects/*` and `/api/brand/*` answered by the
 * in-memory simulator. Installed at module scope so the first fetch the
 * tool makes is already intercepted. `?reset=1` clears it.
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

/**
 * `/dev/growth/prospects/companies?view=new` opens the tool at
 * "/prospects/companies?view=new", the way `?feature=growth&at=…` does in
 * the workspace. From there the tab keeps its own history; the address bar
 * stays where it started, exactly as it does in the real workspace.
 */
export function GrowthPreview({ slug }: { slug: string[] }) {
    const path = `/${slug.join("/")}`;
    const [at, setAt] = useState<string | null>(null);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("reset") === "1") resetSimulator();
        params.delete("reset");
        const query = params.toString();
        setAt(`${path}${query ? `?${query}` : ""}`);
    }, [path]);
    const host = useMemo<ToolHost | null>(
        () => (at === null ? null : { active: true, request: { at, nonce: 1 } }),
        [at]
    );
    if (!host) return null;
    return (
        <div data-preview="growth" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Find companies runs a simulated
                20-second run; Brand posts publish in memory. Add{" "}
                <span className="font-mono">?reset=1</span> to start over.
            </div>
            {/* The tab's box: the tool fills it and scrolls inside it, as it
                does in the workspace. */}
            <div className="min-h-0 flex-1">
                <GrowthTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
