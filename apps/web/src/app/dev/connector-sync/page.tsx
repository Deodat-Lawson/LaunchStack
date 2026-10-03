import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { ConnectorSyncPreview } from "./ConnectorSyncPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function ConnectorSyncPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ConnectorSyncPreview />;
}
