/**
 * Analytics is a section of Settings now, not a page of its own. The route
 * survives as a redirect so existing links and bookmarks keep working.
 */

import { redirect } from "next/navigation";

export default function StatisticsPage() {
    redirect("/employer/settings#analytics");
}
