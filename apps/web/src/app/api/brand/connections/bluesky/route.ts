// POST /api/brand/connections/bluesky — { identifier, appPassword }: connect a Bluesky account (admins)
import type { NextRequest } from "next/server";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { listBrandAccounts } from "~/server/brand/accounts";
import { connectBluesky } from "~/server/brand/channels";
import { isConnectorConfigured } from "~/server/services/connectors/config";

import { brandManageContext, brandT, error, handleBrandError, json, readBody } from "../../_http";

const ConnectSchema = z.object({
    identifier: z.string().trim().min(3).max(256),
    appPassword: z.string().trim().min(8).max(128),
});

export async function POST(request: NextRequest) {
    const auth = await brandManageContext(request);
    if (!auth.ok) return auth.response;
    try {
        const t = brandT(request);
        if (!isConnectorConfigured("bluesky")) return error(t("noSecretsKey"), 503);
        const parsed = ConnectSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(t("blueskyFields"), 400);
        const { connection, channels } = await connectBluesky({
            companyId: auth.ctx.companyId,
            userPk: auth.ctx.userPk,
            identifier: parsed.data.identifier,
            appPassword: parsed.data.appPassword,
        });
        const accounts = await listBrandAccounts(
            auth.ctx.companyId,
            true,
            true,
            localeOfRequest(request)
        );
        const ids = new Set(channels.map(c => c.id));
        return json(
            {
                connection: accounts.connections.find(c => c.id === connection.id),
                channels: accounts.channels.filter(c => ids.has(c.id)),
            },
            201
        );
    } catch (err) {
        return handleBrandError("POST bluesky connection", err, request);
    }
}
