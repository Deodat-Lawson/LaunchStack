import { notFound } from "next/navigation";

import { devRoutesEnabled } from "../enabled";
import { CompanyProfilePreview } from "./CompanyProfilePreview";
import { isProfileFixture } from "./simulator";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

/**
 * Auth-free harness for the company profile — the one page Settings ›
 * Company and Proposals › Profile both render. `?state=` picks a fixture
 * (ready, nothing, building, failed, stale, viewer, empty) and `&variant=`
 * the place it sits (proposals, settings). Mutations change the fixture.
 */
export default async function CompanyProfilePreviewPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!devRoutesEnabled()) notFound();
    const query = await searchParams;
    const state =
        typeof query.state === "string" && isProfileFixture(query.state) ? query.state : "ready";
    const variant = query.variant === "settings" ? "settings" : "proposals";
    return <CompanyProfilePreview state={state} variant={variant} />;
}
