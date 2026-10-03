import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { MeetingsPreview } from "./MeetingsPreview";

export const dynamic = "force-dynamic";

export default function MeetingsPreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <MeetingsPreview />;
}
