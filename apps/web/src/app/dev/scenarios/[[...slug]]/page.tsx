import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../../enabled";
import { ScenariosPreview } from "../ScenariosPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

/** Switches the harness reads itself; the tab never sees them. */
const HARNESS_PARAMS = new Set(["empty", "credits", "theme"]);

/**
 * Auth-free harness for Scenarios. The real tab — its bar, the list, the
 * form, a run with every sub-tab — mounts here over an in-memory simulator of
 * `/api/scenarios/**`. The path picks the screen: `/dev/scenarios/runs/1` is
 * the finished run, `/dev/scenarios/runs/2` the one in progress,
 * `/dev/scenarios/new` the form. Switches: `?empty=1` starts with no runs,
 * `?credits=short` leaves 40 credits so the estimate blocks bigger runs,
 * `?credits=race` passes the estimate and refuses the run with 402,
 * `?theme=light|dark` picks the theme. Development only.
 */
export default async function ScenariosPreviewPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!devRoutesEnabled()) notFound();
    const [{ slug = [] }, query] = await Promise.all([params, searchParams]);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (HARNESS_PARAMS.has(key) || value === undefined) continue;
        if (Array.isArray(value)) value.forEach(v => search.append(key, v));
        else search.set(key, value);
    }
    const qs = search.toString();
    return <ScenariosPreview at={`/${slug.join("/")}${qs ? `?${qs}` : ""}`} />;
}
