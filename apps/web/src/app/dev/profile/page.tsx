import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { ProfileHarness } from "./ProfileHarness";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function ProfilePreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <ProfileHarness />;
}
