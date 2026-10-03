import { notFound } from "next/navigation";

import { ProposalsPreview } from "../ProposalsPreview";

/**
 * Auth-free harness for Proposals. The real tab — the same `ProposalsTool`
 * the workspace mounts, rail and all — runs here over an in-memory simulator
 * of `/api/proposals/*`, so the whole click path (home, the profile, a funder
 * search, a proposal's editor with drafting, rewriting and review, the
 * library) can be exercised without a backend or a login. The URL picks the
 * screen the tab opens on: `/dev/proposals/write/<id>` opens that proposal.
 * Development only.
 */
export default async function ProposalsPreviewPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (process.env.NODE_ENV === "production") notFound();
    const [{ slug = [] }, query] = await Promise.all([params, searchParams]);
    // `?reset=1` is the harness's own; anything else rides into the tab.
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (key === "reset") continue;
        if (Array.isArray(value)) value.forEach(v => search.append(key, v));
        else if (value !== undefined) search.set(key, value);
    }
    const qs = search.toString();
    return (
        <ProposalsPreview
            at={`/${slug.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`}
            reset={query.reset === "1"}
        />
    );
}
