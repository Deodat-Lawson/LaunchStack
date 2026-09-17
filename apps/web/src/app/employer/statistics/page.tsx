/**
 * Analytics is a Studio pane, not a settings section: it is a dashboard you
 * read, and settings is the wrong home for a thing you read. The route
 * survives as a redirect so existing links and bookmarks keep working.
 */

import { redirect } from "next/navigation";

export default function StatisticsPage() {
    redirect("/employer/documents?feature=analytics");
}
