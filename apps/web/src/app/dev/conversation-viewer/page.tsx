import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { ConversationViewerPreview } from "./ConversationViewerPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function ConversationViewerPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ConversationViewerPreview />;
}
