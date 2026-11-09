import type { NextRequest } from "next/server";
import {
    createVantageContextDemoService,
    assertVantageContextDemoEnabled,
} from "~/server/vantage/demo-service";
import { ReviewSchema, demoFailure, json, readBody } from "../_http";
export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const parsed = ReviewSchema.safeParse(await readBody(request));
        if (!parsed.success)
            return json({ error: "Provide the exact topic, report version and review." }, 400);
        return json(await createVantageContextDemoService().review(parsed.data));
    } catch (failure) {
        return demoFailure("PATCH context demo review", failure);
    }
}
