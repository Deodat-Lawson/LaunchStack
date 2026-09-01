import { notFound } from "next/navigation";
import { SessionsBrowserPreview } from "./SessionsBrowserPreview";

export default function SessionsBrowserPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <SessionsBrowserPreview />;
}
