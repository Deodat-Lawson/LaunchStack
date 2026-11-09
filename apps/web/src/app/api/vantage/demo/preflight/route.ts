import type { NextRequest } from "next/server";
import { z } from "zod";
import {
    assertVantageContextDemoEnabled,
    createVantageContextDemoService,
} from "~/server/vantage/demo-service";
import { WeekSchema, demoFailure, json, readBody } from "../_http";
export const dynamic = "force-dynamic";
/** Authenticated local prompt check. The injected boundary makes zero provider calls. */
export async function POST(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const body = z
            .object({ weekStart: WeekSchema })
            .strict()
            .safeParse(await readBody(request));
        if (!body.success) return json({ error: "Choose a reporting week." }, 400);
        return json(await createVantageContextDemoService().preflight(body.data.weekStart));
    } catch (failure) {
        return demoFailure("POST context demo preflight", failure);
    }
}
