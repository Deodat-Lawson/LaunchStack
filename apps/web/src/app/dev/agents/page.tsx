import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { AgentsPreview } from "./AgentsPreview";

export const dynamic = "force-dynamic";

export default function AgentsPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <AgentsPreview />;
}
