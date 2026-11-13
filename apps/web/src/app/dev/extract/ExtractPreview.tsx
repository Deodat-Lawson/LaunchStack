"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ExtractTool } from "~/app/employer/tools/extract/ExtractTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { configureExtractSim, exportCsv, simulateExtraction } from "./extract-sim";

const EXPORT_PATH = /^\/api\/extraction\/(\d+)\/export$/;

/**
 * Answers `/api/extraction/**` from the in-memory simulator. Installed at
 * module scope so the first fetch the tab makes is already intercepted, with
 * a short wait so skeletons and busy states show the way they do live.
 *
 * Export is a plain download link in the tool, which no fetch stub sees, so
 * the harness also catches a click on one and hands over a real CSV built
 * from the simulated table. (XLSX is the server's to build; here it says so.)
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const params = new URLSearchParams(window.location.search);
    configureExtractSim({ empty: params.get("empty") === "1" });
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(url, window.location.origin);
        if (!parsed.pathname.startsWith("/api/extraction")) return real(input, init);
        await new Promise(resolve => setTimeout(resolve, 160));
        return (await simulateExtraction(parsed, init)) ?? real(input, init);
    };
    document.addEventListener(
        "click",
        event => {
            const link = (event.target as Element | null)?.closest?.("a[href]");
            if (!(link instanceof HTMLAnchorElement)) return;
            const target = new URL(link.href, window.location.origin);
            const match = EXPORT_PATH.exec(target.pathname);
            if (!match) return;
            event.preventDefault();
            if (target.searchParams.get("format") === "xlsx") {
                toast("In the app the server builds the .xlsx file. The harness makes CSV only.");
                return;
            }
            const file = exportCsv(Number(match[1]));
            if (!file) return;
            const href = URL.createObjectURL(new Blob([file.content], { type: "text/csv" }));
            const a = document.createElement("a");
            a.href = href;
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
        },
        true
    );
}

stubApi();

/**
 * The Extract tab, alone in a full-height box, the way the workspace hosts
 * it. Client-only, as the workspace's `next/dynamic` load is. Site links (a
 * source, "Ask about these results") would open in the workspace, which
 * needs a login; the harness says where they go instead of leaving.
 */
export function ExtractPreview({ at }: { at: string }) {
    const host = useMemo<ToolHost>(
        () => ({
            active: true,
            request: { at, nonce: 1 },
            openHref: href => toast(`In the app this opens ${decodeURIComponent(href)}`),
            openTool: (toolId, toolAt) => toast(`In the app this opens ${toolId} at ${toolAt}`),
        }),
        [at]
    );
    const [mounted, setMounted] = useState(false);
    const { setTheme } = useTheme();
    useEffect(() => {
        const theme = new URLSearchParams(window.location.search).get("theme");
        if (theme === "light" || theme === "dark") setTheme(theme);
        setMounted(true);
    }, [setTheme]);
    if (!mounted) return null;
    return (
        <div data-preview="extract" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn-ink border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data; a reload starts over. Table 2 reads a
                document every 2.5 seconds; a new table reads one every 0.7. Add{" "}
                <span className="font-mono">?empty=1</span> for no tables.
            </div>
            <div className="min-h-0 flex-1">
                <ExtractTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
