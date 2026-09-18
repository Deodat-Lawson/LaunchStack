import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { SessionsBrowserPreview } from "./SessionsBrowserPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function SessionsBrowserPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <SessionsBrowserPreview />;
}
