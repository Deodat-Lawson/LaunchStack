import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { WorkspacesHarness } from "./WorkspacesHarness";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function WorkspacesPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <WorkspacesHarness />;
}
