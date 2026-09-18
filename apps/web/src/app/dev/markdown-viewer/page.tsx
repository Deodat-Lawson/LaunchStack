import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { MarkdownViewerPreview } from "./MarkdownViewerPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function MarkdownViewerPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <MarkdownViewerPreview />;
}
