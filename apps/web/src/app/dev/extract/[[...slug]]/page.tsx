import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../../enabled";
import { ExtractPreview } from "../ExtractPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

/** Switches the harness reads itself; the tab never sees them. */
const HARNESS_PARAMS = new Set(["empty", "theme"]);

/**
 * Auth-free harness for Extract. The real tab — its bar, the list, the form,
 * a table with its grid — mounts here over an in-memory simulator of
 * `/api/extraction/**`. The path picks the screen: `/dev/extract/t/1` is a
 * finished table, `/dev/extract/t/2` one still being read,
 * `/dev/extract/t/3` one a colleague shared (with a row this viewer cannot
 * open), `/dev/extract/new` the form and `/dev/extract/new?docs=101,102,110`
 * the form as another surface opens it. Switches: `?empty=1` starts with no
 * tables, `?theme=light|dark` picks the theme. Development only.
 */
export default async function ExtractPreviewPage({
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
    return <ExtractPreview at={`/${slug.join("/")}${qs ? `?${qs}` : ""}`} />;
}
