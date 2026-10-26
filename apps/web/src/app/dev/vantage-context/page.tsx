import { notFound } from "next/navigation";
import { devRoutesEnabled } from "../enabled";
import { ContextPreview } from "./ContextPreview";
export const dynamic = "force-dynamic";
export default function PersonalContextPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ContextPreview />;
}
