import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { ProcessingQueuePreview } from "./ProcessingQueuePreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function ProcessingQueuePreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ProcessingQueuePreview />;
}
