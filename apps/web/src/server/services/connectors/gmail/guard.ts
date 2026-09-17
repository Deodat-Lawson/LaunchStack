/**
 * Shared guard for the Gmail routes. A mailbox is personal, so the gate is
 * not `connectors.manage` (a workspace-administration permission) but
 * `documents.upload`: connecting Gmail adds documents to the member's own
 * folder, which is exactly what upload does. The connection a route acts on
 * is always the caller's own — there is no "someone else's mailbox" path.
 */

import type { NextResponse } from "next/server";

import { createForbiddenError, createNotFoundError, createValidationError } from "~/lib/api-utils";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
    type WorkspaceContext,
} from "~/lib/require-workspace-context";
import type { ConnectorConnection } from "~/server/db/schema/connectors";

import { isGmailConnectorConfigured } from "./config";
import { getGmailConnectionForUser } from "./connections";

export type GmailGuardResult =
    | { readonly ok: true; readonly ctx: WorkspaceContext }
    | { readonly ok: false; readonly response: NextResponse };

export function gmailNotConfiguredResponse(): NextResponse {
    return createForbiddenError(
        "The Gmail connector is not enabled on this server. Set GMAIL_CONNECTOR_ENABLED=true, " +
            "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and EMBEDDING_SECRETS_KEY."
    );
}

/** Any active member may read their own Gmail status. */
export async function requireGmailReader(): Promise<GmailGuardResult> {
    const context = await requireWorkspaceContext();
    if (!context.success) return { ok: false, response: context.response };
    return { ok: true, ctx: context.data };
}

/** Connecting, choosing scope and syncing need `documents.upload` and a configured server. */
export async function requireGmailWriter(): Promise<GmailGuardResult> {
    const context = await requireWorkspacePermission("documents.upload");
    if (!context.success) return { ok: false, response: context.response };
    if (!isGmailConnectorConfigured()) return { ok: false, response: gmailNotConfiguredResponse() };
    return { ok: true, ctx: context.data };
}

export type OwnConnectionResult =
    | { readonly ok: true; readonly connection: ConnectorConnection }
    | { readonly ok: false; readonly response: NextResponse };

/** The caller's own active connection, or the response explaining why not. */
export async function requireOwnActiveGmailConnection(
    ctx: WorkspaceContext
): Promise<OwnConnectionResult> {
    const connection = await getGmailConnectionForUser(ctx.companyId, ctx.userPk);
    if (!connection) return { ok: false, response: createNotFoundError("Connect Gmail first.") };
    if (connection.status !== "active") {
        return {
            ok: false,
            response: createValidationError("Gmail access was revoked — reconnect first."),
        };
    }
    return { ok: true, connection };
}
