import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";

import { MindmapPreview } from "./MindmapPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function MindmapPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <MindmapPreview />;
}
