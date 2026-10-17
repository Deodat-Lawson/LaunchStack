// POST /api/brand/post-tests — { text, networks }: simulate how people react to a draft
import type { NextRequest } from "next/server";

import { createPostTest } from "~/server/scenarios/service";

import { handleScenarioError, json, readBody, scenarioContext } from "../../scenarios/_http";

export async function POST(request: NextRequest) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const body = await readBody(request);
        const test = await createPostTest(auth.ctx, {
            text: typeof body.text === "string" ? body.text : "",
            networks: Array.isArray(body.networks) ? (body.networks as string[]) : [],
        });
        return json({ test }, 201);
    } catch (err) {
        return handleScenarioError("POST post test", err);
    }
}
