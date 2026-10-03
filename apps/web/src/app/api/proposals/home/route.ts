// GET /api/proposals/home — the week at a glance: to do, deadlines, funders, profile
import { proposalsContext, handleProposalsError, json } from "../_http";
import { loadHome } from "~/server/proposals/service";

export async function GET() {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await loadHome(auth.ctx));
    } catch (err) {
        return handleProposalsError("GET home", err);
    }
}
