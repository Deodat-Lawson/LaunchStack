import { notFound } from "next/navigation";

import { GrowthPreview } from "../GrowthPreview";

/**
 * Auth-free harness for Growth. Every screen of the real app mounts here over
 * an in-memory simulator of `/api/prospects/*` and `/api/brand/*`, so the
 * whole click path — the Brand calendar and composer, home, companies, a
 * company page, a run with live progress, people, deals, the segment review
 * and sources — can be exercised without a backend or a login. Development
 * only.
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
