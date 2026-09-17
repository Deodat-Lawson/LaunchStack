import { notFound } from "next/navigation";

import { ProspectsPreview } from "../ProspectsPreview";

/**
 * Auth-free harness for Prospects. Every screen of the real tool mounts here
 * over an in-memory simulator of `/api/prospects/*`, so the whole click path
 * — home, companies, a company page, a run with live progress, people,
 * deals, the segment review and sources — can be exercised without a
 * backend or a login. Development only.
 */
export default async function ProspectsPreviewPage({
    params,
}: {
    params: Promise<{ slug?: string[] }>;
}) {
    if (process.env.NODE_ENV === "production") notFound();
    const { slug = [] } = await params;
    return <ProspectsPreview slug={slug} />;
}
