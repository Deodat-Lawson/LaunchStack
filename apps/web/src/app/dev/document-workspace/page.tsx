import { notFound } from "next/navigation";
import { devRoutesEnabled } from "../enabled";
import { DocumentWorkspacePreview } from "./DocumentWorkspacePreview";

export const dynamic = "force-dynamic";

export default function DocumentWorkspacePreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <DocumentWorkspacePreview />;
}
