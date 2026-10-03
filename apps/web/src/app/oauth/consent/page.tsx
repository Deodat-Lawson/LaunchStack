/**
 * Step 2 of connecting an assistant: what it may do, in which workspace.
 * better-auth sends the browser here when there is no stored consent for
 * this assistant, person and workspace. See ~/server/mcp.
 */
import { redirect } from "next/navigation";

import { resolveMemberContext } from "~/lib/require-workspace-context";
import { getServerSession } from "~/server/auth";
import { db } from "~/server/db";
import {
    activeWorkspaceOptions,
    describeScopes,
    loadConnectRequest,
    workspaceName,
} from "~/server/mcp/connect-request";
import { flowKeyOf, resolveGrantWorkspace } from "~/server/mcp/oauth-workspace";
import { ConnectShell, NoConnectionRequest } from "../_components/ConnectShell";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";

function toQuery(params: Record<string, string | string[] | undefined>): URLSearchParams {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            query.append(key, v);
        }
    }
    return query;
}

export default async function OAuthConsentPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const session = await getServerSession();
    if (!session) redirect("/signin");
    const params = await searchParams;
    const [request, workspaceId, workspaces] = await Promise.all([
        loadConnectRequest(params, session.user.id),
        resolveGrantWorkspace(db, session.user.id, session.session.id, flowKeyOf(toQuery(params))),
        activeWorkspaceOptions(session.user.id),
    ]);
    const [workspace, member] = workspaceId
        ? await Promise.all([
              workspaceName(workspaceId),
              resolveMemberContext(session.user.id, BigInt(workspaceId)),
          ])
        : [null, null];
    const access = {
        canRead: member?.can("documents.read") ?? false,
        canSave: member?.can("documents.upload") ?? false,
    };
    return (
        <ConnectShell
            client={request.client}
            step={workspaces.length > 1 ? "Step 2 of 2 · Allow access" : "Allow access"}
        >
            {request.client ? (
                <ConsentForm
                    assistant={request.client.name}
                    workspace={workspace}
                    lines={workspace ? describeScopes(request.scopes, workspace, access) : []}
                    email={session.user.email}
                />
            ) : (
                <NoConnectionRequest />
            )}
        </ConnectShell>
    );
}
