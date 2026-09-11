import { notFound } from "next/navigation";
import { SourceRailPreview } from "./SourceRailPreview";

export default function SourceRailPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <SourceRailPreview />;
}
