import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { AskStartersPreview } from "./AskStartersPreview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function AskStartersPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <AskStartersPreview />;
}
