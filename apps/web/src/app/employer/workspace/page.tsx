import { redirect } from "next/navigation";

import { listPages } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";
import { NotionWorkspace } from "~/components/notion/NotionWorkspace";

export const dynamic = "force-dynamic";

/**
 * Workspace entry point. Opens the most recently edited page so returning to
 * `/employer/workspace` lands where you left off, and falls back to the empty
 * state for a brand-new workspace.
 */
export default async function WorkspaceIndexPage() {
    const session = await getWorkspaceSession();
    if (!session) redirect("/signin");

    const pages = await listPages(session.userId);
    const mostRecent = [...pages]
        .filter((page) => page.parentType !== "database")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    if (mostRecent) redirect(`/employer/workspace/${mostRecent.id}`);

    return <NotionWorkspace initialPageId={null} basePath="/employer/workspace" />;
}
