"use client";

/**
 * Mounts Vercel Analytics unless the signed-in member has opted out.
 *
 * Only ever rendered on the hosted product (see `CloudAnalytics`). Before
 * the settings answer arrives, and on pages with no workspace session, the
 * default applies: on. The opt-out is `privacy.productAnalytics`.
 *
 * Never on a public link's page (`/s/<token>`, ADR-016): its address is the
 * secret that opens the file, and whoever opened it is not a member who
 * could have opted out.
 */

import { Analytics } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";

import { isPublicLinkPath } from "~/lib/public-link-paths";
import { useSettingsPayload } from "~/lib/settings/useSettings";

export function AnalyticsGate() {
    const pathname = usePathname();
    if (isPublicLinkPath(pathname)) return null;
    return <MemberAnalytics />;
}

function MemberAnalytics() {
    const { payload } = useSettingsPayload();
    const allowed = payload?.settings["privacy.productAnalytics"]?.value;
    if (allowed === false) return null;
    return <Analytics />;
}
