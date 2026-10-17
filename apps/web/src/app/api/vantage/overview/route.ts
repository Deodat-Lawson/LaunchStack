// GET /api/vantage/overview — the week at a glance: signals, the agenda in
// progress, commitments to check in on, what was logged lately.
import { handleVantageError, json, vantageContext } from "../_http";
import { loadOverviewV1 } from "~/server/vantage/service-v1";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await loadOverviewV1({ companyId: auth.ctx.companyId }));
    } catch (err) {
        return handleVantageError("GET overview", err);
    }
}
