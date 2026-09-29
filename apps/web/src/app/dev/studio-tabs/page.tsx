import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { StudioTabsPreview } from "./StudioTabsPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function StudioTabsPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <StudioTabsPreview />;
}
