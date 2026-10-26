"use client";

import { useMemo } from "react";
import { VantageTool } from "~/app/employer/tools/vantage/VantageTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

/** Uses real authenticated APIs; it never installs the simulator's fetch override. */
export function VantageContextPreview({ at }: { at: string }) {
    const host = useMemo<ToolHost>(
        () => ({
            active: true,
            request: { at, nonce: 1 },
            hrefForToolPath: destination => {
                const url = new URL(destination, "http://local.invalid");
                return `/dev/vantage-context${url.pathname === "/" ? "/review" : url.pathname}${url.search}`;
            },
        }),
        [at]
    );
    return (
        <div data-preview="vantage-context" className="flex h-dvh flex-col">
            <div className="border-line bg-panel text-ink-3 shrink-0 border-b px-4 py-2 text-[12px]">
                Local synthetic workspace · authenticated session · changes are saved
            </div>
            <div className="min-h-0 flex-1">
                <VantageTool host={host} contextDemoEnabled />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
