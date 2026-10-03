// GET /api/vantage/triage — the program view: shared help requests, missed
// commitments, upcoming deadlines, and how long since the team last logged
// anything. Reads only what the founder chose to share.
import { handleVantageError, json, vantageContext } from "../_http";
import { loadTriage } from "~/server/vantage/service";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await loadTriage({ companyId: auth.ctx.companyId }));
    } catch (err) {
        return handleVantageError("GET triage", err);
    }
}
