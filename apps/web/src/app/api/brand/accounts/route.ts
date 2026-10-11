// GET /api/brand/accounts — networks, the workspace's sign-ins and its channels
import { listBrandAccounts } from "~/server/brand/accounts";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await listBrandAccounts(auth.ctx.companyId, auth.ctx.canManage));
    } catch (err) {
        return handleBrandError("GET accounts", err);
    }
}
