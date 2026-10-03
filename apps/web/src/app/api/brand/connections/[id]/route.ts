// DELETE /api/brand/connections/[id] — disconnect a LinkedIn or Bluesky sign-in (admins)
//
// Its channels go with it (cascade). Posts already scheduled on them fail
// with "This channel was disconnected" instead of posting somewhere else.
// LinkedIn grants are revoked at LinkedIn as well; a Bluesky app password
// can only be revoked in Bluesky's own settings, which the reply says.
import type { NextRequest } from "next/server";

import { BRAND_CONNECTION_PROVIDERS } from "~/server/brand/accounts";
import { getConnectorConfig, PROVIDER_MODULES } from "~/server/services/connectors/config";
import { deleteConnection, getConnectionById } from "~/server/services/connectors/connection-store";
import { publicOrigin } from "~/server/public-origin";

import { brandManageContext, error, handleBrandError, json } from "../../_http";

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await brandManageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id: raw } = await params;
        const id = Number(raw);
        if (!Number.isSafeInteger(id) || id <= 0) return error("Connection not found", 404);
        const connection = await getConnectionById(id);
        if (
            !connection ||
            connection.companyId !== auth.ctx.companyId ||
            !(BRAND_CONNECTION_PROVIDERS as readonly string[]).includes(connection.provider)
        ) {
            return error("Connection not found", 404);
        }
        const tokens = await deleteConnection(id);
        let revoked = false;
        if (connection.provider === "linkedin") {
            const config = getConnectorConfig("linkedin", publicOrigin(request));
            const token = tokens?.accessToken ?? tokens?.refreshToken;
            if (config && token) {
                try {
                    revoked = await PROVIDER_MODULES.linkedin.revokeToken(config, token);
                } catch (revokeError) {
                    console.error("[brand] LinkedIn revocation failed:", revokeError);
                }
            }
        }
        return json({ ok: true, revoked });
    } catch (err) {
        return handleBrandError("DELETE connection", err);
    }
}
