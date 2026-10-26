// GET /api/brand/accounts — networks, the workspace's sign-ins and its channels
import { localeOfRequest } from "~/i18n/server";
import { listBrandAccounts } from "~/server/brand/accounts";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET(request: Request) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        return json(
            await listBrandAccounts(
                auth.ctx.companyId,
                auth.ctx.canManage,
                auth.ctx.canPublish,
                localeOfRequest(request)
            )
        );
    } catch (err) {
        return handleBrandError("GET accounts", err, request);
    }
}
