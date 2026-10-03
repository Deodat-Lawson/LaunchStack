// GET /api/brand/accounts — which networks this workspace can publish to, and from where
import { listBrandAccounts } from "~/server/brand/accounts";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ accounts: await listBrandAccounts(auth.ctx.companyId) });
    } catch (err) {
        return handleBrandError("GET accounts", err);
    }
}
