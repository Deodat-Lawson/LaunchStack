"use client";

/**
 * Mounts Vercel Analytics unless the signed-in member has opted out.
 *
 * Only ever rendered on the hosted product (see `CloudAnalytics`). Before
 * the settings answer arrives, and on pages with no workspace session, the
 * default applies: on. The opt-out is `privacy.productAnalytics`.
 */

import { Analytics } from "@vercel/analytics/next";

import { useSettingsPayload } from "~/lib/settings/useSettings";

export function AnalyticsGate() {
    const { payload } = useSettingsPayload();
    const allowed = payload?.settings["privacy.productAnalytics"]?.value;
    if (allowed === false) return null;
    return <Analytics />;
}
