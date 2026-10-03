// GET /api/proposals/counts — the rail's numbers
import { proposalsContext, handleProposalsError, json } from "../_http";
import { loadCounts } from "~/server/proposals/service";

export async function GET() {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await loadCounts(auth.ctx));
    } catch (err) {
        return handleProposalsError("GET counts", err);
    }
}
