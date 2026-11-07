// GET /api/scenarios/sources — what the new-scenario form can offer the viewer
import { scenarioSourceOptions } from "~/server/scenarios/service";

import { handleScenarioError, json, scenarioContext } from "../_http";

export async function GET(request: Request) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        return json(await scenarioSourceOptions(auth.ctx));
    } catch (err) {
        return handleScenarioError("GET sources", err, request);
    }
}
