import { notFound } from "next/navigation";

import { ProposalsPreview } from "../ProposalsPreview";

/**
 * Auth-free harness for Proposals. Every screen of the real app mounts here
 * over an in-memory simulator of `/api/proposals/*`, so the whole click
 * path — home, the profile, a funder search, a proposal's editor with
 * drafting, rewriting and review, the library — can be exercised without a
 * backend or a login. Development only.
 */
export default async function ProposalsPreviewPage({
    params,
}: {
    params: Promise<{ slug?: string[] }>;
}) {
    if (process.env.NODE_ENV === "production") notFound();
    const { slug = [] } = await params;
    return <ProposalsPreview slug={slug} />;
}
