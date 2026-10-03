"use client";

import { useProspects } from "../prospects/_lib/context";

/**
 * Where the two areas live inside the Growth tab: `brand("/compose")` is
 * "/brand/compose", `prospects("/deals")` is "/prospects/deals". These are
 * app-relative locations for `ToolLink` and `useToolRouter`, not site URLs.
 * The Prospects provider carries its base path and Brand sits beside it.
 */
export function useGrowthPaths(): {
    app: string;
    brand: (path: string) => string;
    prospects: (path: string) => string;
} {
    const { href } = useProspects();
    const prospectsBase = href("");
    const app = prospectsBase.replace(/\/prospects$/, "");
    return {
        app,
        brand: (path: string) => `${app}/brand${path}`,
        prospects: (path: string) => `${prospectsBase}${path}`,
    };
}
