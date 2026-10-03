// GET /api/brand/post-tests/[id] — a post test's progress and result (poll while it's going)
import type { NextRequest } from "next/server";

import { getPostTest } from "~/server/scenarios/service";

import {
    error,
    handleScenarioError,
    json,
    runIdFrom,
    scenarioContext,
} from "../../../scenarios/_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return error("Post test not found", 404);
        return json({ test: await getPostTest(auth.ctx, id) });
    } catch (err) {
        return handleScenarioError("GET post test", err);
    }
}
