import { notFound } from "next/navigation";
import { ConversationViewerPreview } from "./ConversationViewerPreview";

export default function ConversationViewerPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <ConversationViewerPreview />;
}
