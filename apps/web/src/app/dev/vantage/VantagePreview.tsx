"use client";

import { useEffect, useMemo, useState } from "react";

import { VantageTool } from "~/app/employer/tools/vantage/VantageTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { simulateVantage } from "./simulator";

/**
 * Answers `/api/vantage/*` (and the permissions lookup) from the in-memory
 * simulator. Installed at module scope so the first fetch the tab makes is
 * already intercepted. `?as=member` is read per request, so the preview
 * person's permissions follow the URL.
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const admin = new URLSearchParams(window.location.search).get("as") !== "member";
        const simulated = await simulateVantage(new URL(url, window.location.origin), init, admin);
        return simulated ?? real(input, init);
    };
}

stubApi();

/**
 * The Vantage tab, alone in a full-height box, the way the workspace hosts
 * it. Client-only, as the workspace's `next/dynamic` load is: rendered on the
 * server, the stubbed permissions answer could land mid-hydration and add the
 * Program group to a tree React is still matching against the server's HTML.
 */
export function VantagePreview({ at }: { at: string }) {
    const host = useMemo<ToolHost>(() => ({ active: true, request: { at, nonce: 1 } }), [at]);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return (
        <div data-preview="vantage" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data; a reload starts over. Add{" "}
                <span className="font-mono">?as=member</span> to see it without settings.manage.
            </div>
            <div className="min-h-0 flex-1">
                <VantageTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
