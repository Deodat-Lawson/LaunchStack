/**
 * Step 2 of connecting an assistant: what it may do, in which workspace.
 * better-auth sends the browser here when there is no stored consent for
 * this assistant, person and workspace. See ~/server/mcp.
 */
import { redirect } from "next/navigation";

import { getServerSession } from "~/server/auth";
import { db } from "~/server/db";
import {
    activeWorkspaceOptions,
    describeScopes,
    loadConnectRequest,
    workspaceName,
} from "~/server/mcp/connect-request";
import { resolveGrantWorkspace } from "~/server/mcp/oauth-workspace";
import { ConnectShell } from "../_components/ConnectShell";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const session = await getServerSession();
    if (!session) redirect("/signin");
    const params = await searchParams;
    const [request, workspaceId, workspaces] = await Promise.all([
        loadConnectRequest(params),
        resolveGrantWorkspace(db, session.user.id, session.session.id),
        activeWorkspaceOptions(session.user.id),
    ]);
    const workspace = workspaceId ? await workspaceName(workspaceId) : null;
    return (
        <ConnectShell
            client={request.client}
            step={workspaces.length > 1 ? "Step 2 of 2 · Allow access" : "Allow access"}
        >
            <ConsentForm
                assistant={request.client?.name ?? "this assistant"}
                workspace={workspace}
                lines={workspace ? describeScopes(request.scopes, workspace) : []}
                email={session.user.email}
            />
        </ConnectShell>
    );
}
