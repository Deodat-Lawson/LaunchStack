import { notFound } from "next/navigation";

import { DistributionPreview } from "./DistributionPreview";

/**
 * Auth-free harness for the Distribution tool. Mounts the real page with the
 * session-guarded `/api/distribution/*` routes answered by an in-memory
 * simulator, so the whole click path — programs, a sample run, the partner
 * drawer, stage moves, agreements, outreach — can be exercised without a
 * backend or a login. Development only.
 */
export default function DistributionPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <DistributionPreview />;
}
