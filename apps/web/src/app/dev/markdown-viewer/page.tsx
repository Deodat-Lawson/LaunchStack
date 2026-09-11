import { notFound } from "next/navigation";
import { MarkdownViewerPreview } from "./MarkdownViewerPreview";

export default function MarkdownViewerPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <MarkdownViewerPreview />;
}
