"use client";

import { useEffect, useMemo, useState } from "react";

import { VantageTool } from "~/app/employer/tools/vantage/VantageTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { simulateContractVantage } from "./contractSimulator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";

/** Install the synthetic contract transport before any preview component fetches. */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const simulated = await simulateContractVantage(new URL(url, window.location.origin), init);
        return simulated ?? real(input, init);
    };
}

stubApi();

/**
 * The Vantage tab, alone in a full-height box, the way the workspace hosts
 * it. Client-only, like the workspace's dynamic tool load, so fixture requests
 * never run during server rendering.
 */
export function VantagePreview({ at }: { at: string }) {
    const host = useMemo<ToolHost>(
        () => ({
            active: true,
            request: { at, nonce: 1 },
            hrefForToolPath: destination => {
                const url = new URL(destination, window.location.origin);
                const scenario = new URLSearchParams(window.location.search).get("scenario");
                if (scenario) url.searchParams.set("scenario", scenario);
                return `/dev/vantage${url.pathname === "/" ? "" : url.pathname}${url.search}`;
            },
        }),
        [at]
    );
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return (
        <div data-preview="vantage" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs">
                <span>
                    Synthetic Contract v1 preview · fixed clock: Oct 17, 2026 · changes reset on
                    reload · no sign-in needed · no live database or AI
                </span>
                <Select
                    value={new URLSearchParams(window.location.search).get("scenario") ?? "ai"}
                    onValueChange={scenario => {
                        const url = new URL(window.location.href);
                        url.searchParams.set("scenario", scenario);
                        window.location.assign(url);
                    }}
                >
                    <SelectTrigger aria-label="Preview scenario" className="h-8 w-44">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {[
                            "ai",
                            "fresh",
                            "rules",
                            "fallback",
                            "empty",
                            "legacy",
                            "unavailable",
                            "failed",
                            "stale",
                            "lost-response",
                            "denied",
                            "signed-out",
                        ].map(s => (
                            <SelectItem key={s} value={s}>
                                {s}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="min-h-0 flex-1">
                <VantageTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
