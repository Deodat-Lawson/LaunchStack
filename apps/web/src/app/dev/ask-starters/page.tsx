import { notFound } from "next/navigation";
import { AskStartersPreview } from "./AskStartersPreview";

export default function AskStartersPreviewPage() {
    if (process.env.NODE_ENV === "production") notFound();
    return <AskStartersPreview />;
}
