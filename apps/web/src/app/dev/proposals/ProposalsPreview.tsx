"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProposalsTool } from "~/app/employer/tools/proposals/ProposalsTool";
import type { ToolHost } from "~/components/tool-app/nav";
import { Toaster } from "~/components/ui/sonner";

import { simulateCompanyProfile } from "../company-profile/simulator";
import { resetProposalsSim, simulateProposals } from "./simulator";

/**
 * Mounts the real Proposals tab with `/api/proposals/*` and
 * `/api/company/profile*` answered by in-memory simulators. Installed at
 * module scope so the first fetch the tab makes is already intercepted.
 * `?reset=1` clears it.
 */
let stubbed = false;
function stubApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const target = new URL(url, "http://proposals.local");
        // Proposals › Profile is the shared company profile; its routes have
        // their own simulator (see /dev/company-profile for every state).
        const simulated =
            (await simulateCompanyProfile(target, init, "ready")) ??
            (await simulateProposals(target, init, Date.now()));
        return simulated ?? real(input, init);
    };
}

stubApi();

export function ProposalsPreview({ at, reset }: { at: string; reset: boolean }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (reset) resetProposalsSim();
        setReady(true);
    }, [reset]);
    // Stands in for the workspace shell. Site links (a source, `?ask=`, the
    // Investor relations tab) would open in the workspace, which needs a
    // login; the harness says where they go instead of leaving.
    const host = useMemo<ToolHost>(
        () => ({
            active: true,
            request: { at, nonce: 1 },
            openHref: href => toast(`In the app this opens ${href}`),
            openTool: (toolId, toolAt) => toast(`In the app this opens ${toolId} at ${toolAt}`),
        }),
        [at]
    );
    if (!ready) return null;
    return (
        <div data-preview="proposals" className="flex h-dvh flex-col">
            <div className="bg-warn-soft text-warn border-warn/40 shrink-0 border-b px-4 py-1.5 text-center text-xs">
                Preview harness — no login, in-memory data. Runs finish in a few seconds and change
                what you see. Add <span className="font-mono">?reset=1</span> to start over.
            </div>
            <div className="min-h-0 flex-1">
                <ProposalsTool host={host} />
            </div>
            <Toaster richColors position="top-right" />
        </div>
    );
}
