import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { SourceRailPreview } from "./SourceRailPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function SourceRailPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <SourceRailPreview />;
}
