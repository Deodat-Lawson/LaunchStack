// GET /api/brand/post-tests/track-record — simulated vs real engagement for tested posts
import { brandTrackRecord } from "~/server/scenarios/service";

import { handleScenarioError, json, scenarioContext } from "../../../scenarios/_http";

export async function GET(request: Request) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ record: await brandTrackRecord(auth.ctx) });
    } catch (err) {
        return handleScenarioError("GET track record", err, request);
    }
}
