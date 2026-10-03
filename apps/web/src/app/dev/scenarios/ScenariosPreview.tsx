"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";

import { ScenariosTool } from "~/app/employer/tools/scenarios/ScenariosTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { configureScenariosSim, simulateScenarios } from "./scenarios-sim";

/**
 * Answers `/api/scenarios/**` from the in-memory simulator. Installed at
 * module scope so the first fetch the tab makes is already intercepted, with
 * a short wait so skeletons and busy states show the way they do live.
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const params = new URLSearchParams(window.location.search);
    const credits = params.get("credits");
    configureScenariosSim({
        empty: params.get("empty") === "1",
        credits: credits === "short" || credits === "race" ? credits : "ok",
    });
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(url, window.location.origin);
        if (!parsed.pathname.startsWith("/api/scenarios")) return real(input, init);
        await new Promise(resolve => setTimeout(resolve, 160));
        const simulated = await simulateScenarios(parsed, init);
        return simulated ?? real(input, init);
    };
}

stubApi();

/**
 * The Scenarios tab, alone in a full-height box, the way the workspace hosts
 * it. Client-only, as the workspace's `next/dynamic` load is. Another tool's
 * link (a source, Growth) leaves the harness for the real page.
 */
export function ScenariosPreview({ at }: { at: string }) {
    const host = useMemo<ToolHost>(() => ({ active: true, request: { at, nonce: 1 } }), [at]);
    const [mounted, setMounted] = useState(false);
    const { setTheme } = useTheme();
    useEffect(() => {
        const theme = new URLSearchParams(window.location.search).get("theme");
        if (theme === "light" || theme === "dark") setTheme(theme);
        setMounted(true);
    }, [setTheme]);
    if (!mounted) return null;
    return (
        <div data-preview="scenarios" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data; a reload starts over. Run 2 finishes a
                round every 5 seconds. Add <span className="font-mono">?empty=1</span> for no runs,{" "}
                <span className="font-mono">?credits=short</span> or{" "}
                <span className="font-mono">?credits=race</span> for the credit checks.
            </div>
            <div className="min-h-0 flex-1">
                <ScenariosTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
