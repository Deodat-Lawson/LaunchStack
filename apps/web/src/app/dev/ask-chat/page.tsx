import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { AskChatPreview } from "./AskChatPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function AskChatPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <AskChatPreview />;
}
