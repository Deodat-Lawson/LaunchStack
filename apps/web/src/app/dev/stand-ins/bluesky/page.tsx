import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { devRoutesEnabled } from "~/app/dev/enabled";

import { requestOrigin } from "../shared/origin";
import { BlueskyStandIn } from "./BlueskyStandIn";
import { BLUESKY_BASE_PATH, blueskySnapshot } from "./world";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "Bluesky stand-in" } };

/** `/dev/stand-ins/bluesky` — the stand-in's own view of what an app did to it. */
export default async function BlueskyStandInPage() {
    if (!devRoutesEnabled()) notFound();
    return (
        <BlueskyStandIn
            initial={blueskySnapshot()}
            base={BLUESKY_BASE_PATH}
            origin={requestOrigin(await headers())}
        />
    );
}
