// GET /api/vantage/triage — the program view: shared help requests, missed
// commitments, upcoming deadlines, and how long since the team last logged
// anything. Reads only what the founder chose to share, and only for
// settings.manage: the program's side of the table, same as its rail entry.
import { error, handleVantageError, json, vantageContext } from "../_http";
import { loadTriage } from "~/server/vantage/service";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("settings.manage"))
        return error("Only a workspace admin can see program triage.", 403, {
            permission: "settings.manage",
        });
    try {
        return json(await loadTriage({ companyId: auth.ctx.companyId }));
    } catch (err) {
        return handleVantageError("GET triage", err);
    }
}
