"use client";

import { useProspects } from "../prospects/_lib/context";

/**
 * Where the two areas live. The Prospects provider carries the app's base
 * path (so the same screens mount in the preview harness under /dev), and
 * Brand sits beside it.
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
