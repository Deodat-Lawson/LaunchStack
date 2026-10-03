import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../../enabled";
import { VantagePreview } from "../VantagePreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

/**
 * Auth-free harness for Vantage. The real tab — rail, back and forward, every
 * screen — mounts here over an in-memory simulator of `/api/vantage/*`, so
 * the weekly loop can be clicked through without a backend or a login. The
 * path and query pick the screen the tab opens on: `/dev/vantage/agenda?week=…`
 * is the agenda for that week. `?as=member` previews it for someone without
 * `settings.manage` (no Program group, Triage refuses). Development only.
 */
export default async function VantagePreviewPage({
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
        // `as` is the harness's own; the tab never sees it.
        if (key === "as" || value === undefined) continue;
        if (Array.isArray(value)) value.forEach(v => search.append(key, v));
        else search.set(key, value);
    }
    const qs = search.toString();
    return <VantagePreview at={`/${slug.join("/")}${qs ? `?${qs}` : ""}`} />;
}
