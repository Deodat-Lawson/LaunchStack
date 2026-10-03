import { notFound } from "next/navigation";

import { GrowthPreview } from "../GrowthPreview";

/**
 * Auth-free harness for Growth. The real pages mount here over an in-memory
 * simulator of `/api/prospects/*` and `/api/brand/*`, so the whole click
 * path — the front door, Brand's week with its composer and accounts, the
 * campaign generator, Prospects with its company panel, a run with live
 * progress, the deals board and the segment — can be exercised without a
 * backend or a login. Development only.
 */
export default async function GrowthPreviewPage({
    params,
}: {
    params: Promise<{ slug?: string[] }>;
}) {
    if (process.env.NODE_ENV === "production") notFound();
    const { slug = [] } = await params;
    return <GrowthPreview slug={slug} />;
}
