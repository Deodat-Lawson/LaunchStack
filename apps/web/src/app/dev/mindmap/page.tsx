import { notFound } from "next/navigation";

import { MindmapPreview } from "./MindmapPreview";

export default function MindmapPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <MindmapPreview />;
}
