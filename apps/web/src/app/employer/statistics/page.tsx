/**
 * Analytics was a Studio app until it folded into the Usage tab (the
 * workspace's and each person's numbers, and which documents get opened).
 * The route survives as a redirect so existing links and bookmarks keep
 * working.
 */

import { redirect } from "next/navigation";

import { toolTabHref } from "~/lib/tool-app/locations";

export default function StatisticsPage() {
    redirect(toolTabHref("usage", "/overview"));
}
