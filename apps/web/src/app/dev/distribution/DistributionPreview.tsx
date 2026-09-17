"use client";

import { useEffect, useState } from "react";

import DistributionPage from "~/app/employer/tools/distribution/page";

import { resetSimulator, simulate } from "./simulator";

/**
 * Mounts the real Distribution page with `/api/distribution/*` answered by
 * the in-memory simulator. Installed at module scope so the first fetch the
 * page makes is already intercepted.
 *
 * Flags: `?reset=1` clears the simulator's state.
 */
let stubbed = false;
function stubDistributionApi() {
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

stubDistributionApi();

export function DistributionPreview() {
    // Client-only: the page reads the simulator on mount and the simulator
    // holds browser-side state, so a server pass would render a different tree.
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("reset") === "1") resetSimulator();
        setReady(true);
    }, []);
    if (!ready) return null;
    return (
        <div data-preview="distribution" style={{ minHeight: "100dvh" }}>
            <div className="bg-warn-soft text-warn border-warn/40 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Turn on “Use sample data” in Runs to
                populate.
            </div>
            <DistributionPage />
        </div>
    );
}
