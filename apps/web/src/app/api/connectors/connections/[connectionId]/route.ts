/**
 * Disconnect a connection.
 *
 * DELETE — a per-user connection (Notion, Gmail) may be removed by its owner,
 * whatever their role; anything else needs `connectors.manage`, which is also
 * the admin's offboarding path for someone else's per-user connection. A
 * member asking for another member's per-user connection is told it does not
 * exist, as if they had guessed an id. Removes the row; for the generic OAuth providers
 * (Slack, GitHub, LinkedIn, Notion) and Gmail it then best-effort revokes the
 * grant at the provider so a copied token dies with the connection (Drive
 * rows are simply deleted — the Drive services own no revocation endpoint,
 * matching DELETE /api/connectors/google). Documents a connection imported
 * are kept.
 * Cross-tenant deletes are impossible: the row must belong to the caller's
 * active workspace. Every disconnect is recorded in the audit log
 * (`connector.disconnected`), marked `offboarding` when an admin removed
 * someone else's per-user connection. Settings disconnects a member's own
 * Gmail through DELETE /api/connectors/gmail.
 */

import { requestTranslator } from "~/i18n/server";
import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    handleApiError,
} from "~/lib/api-utils";
import { recordAuditEvent } from "~/lib/authz/audit";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { db } from "~/server/db";
import { deleteConnection, getConnectionById } from "~/server/services/connectors/connection-store";
import { revokeConnectionTokens } from "~/server/services/connectors/revoke";
import { publicOrigin } from "~/server/public-origin";

export const runtime = "nodejs";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ connectionId: string }> }
) {
    const t = requestTranslator(request, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const context = await requireWorkspaceContext();
            if (!context.success) return context.response;
            const ctx = context.data;

            const { connectionId } = await params;
            const id = Number(connectionId);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return createNotFoundError(t("connectionNotFound"));
            }

            const connection = await getConnectionById(id);
            if (!connection || connection.companyId !== ctx.companyId) {
                return createNotFoundError(t("connectionNotFound"));
            }
            const own = connection.ownerUserId != null && connection.ownerUserId === ctx.userPk;
            if (!own && !ctx.can("connectors.manage")) {
                return connection.ownerUserId != null
                    ? createNotFoundError(t("connectionNotFound"))
                    : createForbiddenError(t("manageRequired"));
            }

            const provider = connection.provider;
            const tokens = await deleteConnection(id);
            // Best-effort provider-side revocation; the row is already gone.
            const revoked = await revokeConnectionTokens(provider, tokens, publicOrigin(request));

            await recordAuditEvent(db, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "connector.disconnected",
                targetType: "connector",
                targetId: provider,
                detail: {
                    connectionId: connection.id,
                    accountName: connection.providerAccountEmail,
                    providerRevoked: revoked,
                    ...(connection.ownerUserId != null
                        ? { ownerUserId: connection.ownerUserId.toString(), offboarding: !own }
                        : {}),
                },
            });

            return createSuccessResponse(
                { deleted: true, providerRevoked: revoked },
                t(revoked ? "disconnectedRevoked" : "disconnectedNotRevoked")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
