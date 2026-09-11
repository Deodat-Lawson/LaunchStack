/**
 * Shared guard for every connector route: verified workspace context +
 * `connectors.manage`. Connecting a provider hands its data to the shared
 * company knowledge base (or speaks for the company, in Slack's case), so it
 * is a workspace-administration action — same posture as the agent-knowledge
 * connector.
 */

import type { NextResponse } from "next/server";

import { createForbiddenError } from "~/lib/api-utils";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import type { ConnectorProvider } from "~/server/db/schema/connectors";

export type ConnectorAdminResult =
    | { readonly ok: true; readonly ctx: WorkspaceContext }
    | { readonly ok: false; readonly response: NextResponse };

export async function requireConnectorAdmin(): Promise<ConnectorAdminResult> {
    const context = await requireWorkspaceContext();
    if (!context.success) return { ok: false, response: context.response };
    if (!context.data.can("connectors.manage")) {
        return {
            ok: false,
            response: createForbiddenError("The connectors.manage permission is required."),
        };
    }
    return { ok: true, ctx: context.data };
}

const ENV_PAIRS: Record<ConnectorProvider, string> = {
    "google-drive": "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    slack: "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET",
    github: "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET",
};

export function notConfiguredResponse(provider: ConnectorProvider): NextResponse {
    return createForbiddenError(
        `The ${provider} connector is not configured. Set ${ENV_PAIRS[provider]} and EMBEDDING_SECRETS_KEY on the server.`
    );
}
