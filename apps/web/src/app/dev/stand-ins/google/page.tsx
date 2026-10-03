import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { devRoutesEnabled } from "~/app/dev/enabled";

import { requestOrigin } from "../shared/origin";
import { googleSnapshot } from "./dispatch";
import { GoogleStandIn } from "./GoogleStandIn";
import { GOOGLE_BASE_PATH } from "./world";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "Google stand-in" } };

/** `/dev/stand-ins/google` — the stand-in's own view of the Drive an app is reading. */
export default async function GoogleStandInPage() {
    if (!devRoutesEnabled()) notFound();
    return (
        <GoogleStandIn
            initial={googleSnapshot()}
            base={GOOGLE_BASE_PATH}
            origin={requestOrigin(await headers())}
        />
    );
}
