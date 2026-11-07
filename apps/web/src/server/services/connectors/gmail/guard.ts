/**
 * Shared guard for the Gmail routes. A mailbox is personal, so the gate is
 * not `connectors.manage` (a workspace-administration permission) but
 * `documents.upload`: connecting Gmail adds documents to the member's own
 * folder, which is exactly what upload does. The connection a route acts on
 * is always the caller's own — there is no "someone else's mailbox" path.
 */

import type { NextResponse } from "next/server";

import type { Locale } from "~/i18n/locales";
import { requestLocaleOrDefault } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
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

/** In `locale` (English by default, as before). */
export function gmailNotConfiguredResponse(locale: Locale = "en"): NextResponse {
    return createForbiddenError(translatorFor(locale, "sources.server.gmail")("notConfigured"));
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
    if (!isGmailConnectorConfigured()) {
        return { ok: false, response: gmailNotConfiguredResponse(await requestLocaleOrDefault()) };
    }
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
    if (!connection || connection.status !== "active") {
        const t = translatorFor(await requestLocaleOrDefault(), "sources.server.gmail");
        return {
            ok: false,
            response: connection
                ? createValidationError(t("accessRevoked"))
                : createNotFoundError(t("connectFirst")),
        };
    }
    return { ok: true, connection };
}
