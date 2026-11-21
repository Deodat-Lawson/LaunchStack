import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { devRoutesEnabled } from "~/app/dev/enabled";

import { requestOrigin } from "../shared/origin";
import { microsoftSnapshot } from "./dispatch";
import { MicrosoftStandIn } from "./MicrosoftStandIn";
import { MICROSOFT_BASE_PATH } from "./world";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../../enabled.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "Microsoft stand-in" } };

/** `/dev/stand-ins/microsoft` — the stand-in's own view of the files and mail an app is reading. */
export default async function MicrosoftStandInPage() {
    if (!devRoutesEnabled()) notFound();
    return (
        <MicrosoftStandIn
            initial={microsoftSnapshot()}
            base={MICROSOFT_BASE_PATH}
            origin={requestOrigin(await headers())}
        />
    );
}
