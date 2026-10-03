import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { devRoutesEnabled } from "~/app/dev/enabled";

import { requestOrigin } from "../shared/origin";
import { LinkedInStandIn } from "./LinkedInStandIn";
import { LINKEDIN_BASE_PATH, linkedInSnapshot } from "./world";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "LinkedIn stand-in" } };

/** `/dev/stand-ins/linkedin` — the stand-in's own view of what an app did to it. */
export default async function LinkedInStandInPage() {
    if (!devRoutesEnabled()) notFound();
    return (
        <LinkedInStandIn
            initial={linkedInSnapshot()}
            base={LINKEDIN_BASE_PATH}
            origin={requestOrigin(await headers())}
        />
    );
}
