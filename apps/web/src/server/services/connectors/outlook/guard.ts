/**
 * Shared guard for the Outlook routes, the Gmail guard's twin. A mailbox is
 * personal, so the gate is not `connectors.manage` (workspace
 * administration) but `documents.upload`: connecting Outlook adds documents
 * to the member's own folder, which is what upload does. The connection a
 * route acts on is always the caller's own. There is no "someone else's
 * mailbox" path, for an admin or anyone else.
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
import { isOutlookConnectorConfigured } from "~/server/services/microsoft/config";
import { getOutlookConnectionForUser } from "~/server/services/microsoft/connections";

export type OutlookGuardResult =
    | { readonly ok: true; readonly ctx: WorkspaceContext }
    | { readonly ok: false; readonly response: NextResponse };

export function outlookNotConfiguredResponse(locale: Locale = "en"): NextResponse {
    return createForbiddenError(translatorFor(locale, "sources.server.outlook")("notConfigured"));
}

/** Any active member may read their own Outlook status, and disconnect it. */
export async function requireOutlookReader(): Promise<OutlookGuardResult> {
    const context = await requireWorkspaceContext();
    if (!context.success) return { ok: false, response: context.response };
    return { ok: true, ctx: context.data };
}

/** Choosing what syncs and syncing need `documents.upload` and a configured server. */
export async function requireOutlookWriter(): Promise<OutlookGuardResult> {
    const context = await requireWorkspacePermission("documents.upload");
    if (!context.success) return { ok: false, response: context.response };
    if (!isOutlookConnectorConfigured()) {
        return {
            ok: false,
            response: outlookNotConfiguredResponse(await requestLocaleOrDefault()),
        };
    }
    return { ok: true, ctx: context.data };
}

export type OwnOutlookConnectionResult =
    | { readonly ok: true; readonly connection: ConnectorConnection }
    | { readonly ok: false; readonly response: NextResponse };

/** The caller's own active connection, or the response explaining why not. */
export async function requireOwnActiveOutlookConnection(
    ctx: WorkspaceContext
): Promise<OwnOutlookConnectionResult> {
    const connection = await getOutlookConnectionForUser(ctx.companyId, ctx.userPk);
    if (!connection || connection.status !== "active") {
        const t = translatorFor(await requestLocaleOrDefault(), "sources.server.outlook");
        return {
            ok: false,
            response: connection
                ? createValidationError(t("accessRevoked"))
                : createNotFoundError(t("connectFirst")),
        };
    }
    return { ok: true, connection };
}
