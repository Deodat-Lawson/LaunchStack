import { notFound, redirect } from "next/navigation";

import { NotionWorkspace } from "~/components/notion/NotionWorkspace";
import {
    getBacklinks,
    getBreadcrumb,
    getPage,
    serializePage,
} from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

export const dynamic = "force-dynamic";

/**
 * One page, rendered on the server so the first paint shows real content
 * rather than a spinner. Navigation between pages afterwards is client-side.
 */
export default async function WorkspacePage({
    params,
}: {
    params: Promise<{ pageId: string }>;
}) {
    const session = await getWorkspaceSession();
    if (!session) redirect("/signin");

    const { pageId } = await params;
    const page = await getPage(session.userId, pageId);
    if (!page) notFound();

    const [breadcrumb, backlinks] = await Promise.all([
        getBreadcrumb(session.userId, pageId),
        getBacklinks(session.userId, pageId),
    ]);

    return (
        <NotionWorkspace
            initialPageId={pageId}
            initialPage={serializePage(page)}
            initialBreadcrumb={breadcrumb}
            initialBacklinks={backlinks}
            basePath="/employer/workspace"
        />
    );
}
