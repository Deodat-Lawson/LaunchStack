"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { GrowthTool } from "~/app/employer/tools/growth/GrowthTool";
import { LINKEDIN_CONNECT_HREF } from "~/app/employer/tools/growth/brand/api";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { configureBrandSim, simulateLinkedInConnect } from "./brand-sim";
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

/** The OAuth start path, without its query: any link to it counts. */
const LINKEDIN_START = LINKEDIN_CONNECT_HREF.split("?")[0]!;

/** Harness switches read from the address bar; they are not part of the tab's location. */
const HARNESS_PARAMS = ["reset", "member", "viewer", "reconnect", "empty", "nosync"] as const;

/**
 * `/dev/growth/prospects/companies?view=new` opens the tool at
 * "/prospects/companies?view=new", the way `?feature=growth&at=…` does in
 * the workspace. From there the tab keeps its own history; the address bar
 * stays where it started, exactly as it does in the real workspace.
 *
 * Brand switches: `?member=1` reads Accounts as a non-admin, `?reconnect=1`
 * has Bluesky refuse its app password, `?empty=1` starts with nothing
 * connected, `?nosync=1` with no numbers read yet.
 */
export function GrowthPreview({ slug }: { slug: string[] }) {
    const path = `/${slug.join("/")}`;
    const [at, setAt] = useState<string | null>(null);
    // A completed OAuth round trip is a full page load in the real app; the
    // harness remounts the tool instead, at Accounts.
    const [mount, setMount] = useState(1);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("reset") === "1") resetSimulator();
        configureBrandSim({
            canManage: params.get("member") !== "1" && params.get("viewer") !== "1",
            canPublish: params.get("viewer") !== "1",
            reconnect: params.get("reconnect") === "1",
            empty: params.get("empty") === "1",
            nosync: params.get("nosync") === "1",
        });
        for (const key of HARNESS_PARAMS) params.delete(key);
        const query = params.toString();
        setAt(`${path}${query ? `?${query}` : ""}`);
    }, [path]);

    // "Connect LinkedIn" is a real link to the OAuth start, which would leave
    // for LinkedIn. Catch it before the browser follows it and play the
    // round trip in memory.
    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const link = target?.closest("a[href]");
            if (!link) return;
            const href = link.getAttribute("href") ?? "";
            if (!href.startsWith(LINKEDIN_START)) return;
            event.preventDefault();
            event.stopPropagation();
            const { accountName } = simulateLinkedInConnect();
            toast.success(`Connected LinkedIn as ${accountName}`);
            setAt("/brand/accounts");
            setMount(n => n + 1);
        };
        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, []);

    const host = useMemo<ToolHost | null>(
        () => (at === null ? null : { active: true, request: { at, nonce: mount } }),
        [at, mount]
    );
    if (!host) return null;
    return (
        <div data-preview="growth" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Find companies runs a simulated
                20-second run; Brand posts publish in memory and Connect LinkedIn signs in as Dana
                Okafor. Add <span className="font-mono">?reset=1</span> to start over,{" "}
                <span className="font-mono">?member=1</span> to read as a non-admin,{" "}
                <span className="font-mono">?viewer=1</span> as a Viewer who cannot post.
            </div>
            {/* The tab's box: the tool fills it and scrolls inside it, as it
                does in the workspace. */}
            <div className="min-h-0 flex-1">
                <GrowthTool key={mount} host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
