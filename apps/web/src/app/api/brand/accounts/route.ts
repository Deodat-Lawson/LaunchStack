// GET /api/brand/accounts — which networks this deployment can publish to
import { listBrandAccounts } from "~/server/brand/accounts";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ accounts: listBrandAccounts() });
    } catch (err) {
        return handleBrandError("GET accounts", err);
    }
}
