import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";

import { ArtifactsPreview } from "./ArtifactsPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function ArtifactsPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ArtifactsPreview />;
}
