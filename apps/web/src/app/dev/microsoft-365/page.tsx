import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { Microsoft365Preview } from "./Microsoft365Preview";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

export default function Microsoft365PreviewPage() {
    if (!devRoutesEnabled()) notFound();
    return <Microsoft365Preview />;
}
