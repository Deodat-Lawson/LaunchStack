import { notFound } from "next/navigation";

import { ArtifactsPreview } from "./ArtifactsPreview";

export default function ArtifactsPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <ArtifactsPreview />;
}
