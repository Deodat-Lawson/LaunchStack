/**
 * Step 1 of connecting an assistant, for people in more than one workspace:
 * which workspace may it see? better-auth's post-login hook sends the
 * browser here (single-workspace people skip it). See ~/server/mcp.
 */
import { redirect } from "next/navigation";

import { getServerSession } from "~/server/auth";
import { activeWorkspaceOptions, loadConnectRequest } from "~/server/mcp/connect-request";
import { ConnectShell } from "../_components/ConnectShell";
import { WorkspaceChoice } from "./WorkspaceChoice";

export const dynamic = "force-dynamic";

export default async function OAuthWorkspacePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const session = await getServerSession();
    if (!session) redirect("/signin");
    const params = await searchParams;
    const [request, workspaces] = await Promise.all([
        loadConnectRequest(params),
        activeWorkspaceOptions(session.user.id),
    ]);
    return (
        <ConnectShell client={request.client} step="Step 1 of 2 · Workspace">
            <WorkspaceChoice
                assistant={request.client?.name ?? "this assistant"}
                workspaces={workspaces}
            />
        </ConnectShell>
    );
}
