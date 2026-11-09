import type { NextRequest } from "next/server";
import { z } from "zod";
import {
    createVantageContextDemoService,
    assertVantageContextDemoEnabled,
} from "~/server/vantage/demo-service";
import { WeekSchema, demoFailure, json, readBody } from "./_http";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const week = request.nextUrl.searchParams.get("week");
        if (week !== null && !WeekSchema.safeParse(week).success)
            return json({ error: "Choose a reporting week." }, 400);
        return json(await createVantageContextDemoService().load(week ?? undefined));
    } catch (failure) {
        return demoFailure("GET context demo", failure);
    }
}
export async function POST(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const parsed = z
            .object({ weekStart: WeekSchema })
            .strict()
            .safeParse(await readBody(request));
        if (!parsed.success) return json({ error: "Choose a reporting week." }, 400);
        return json(
            await createVantageContextDemoService().generateWeek(parsed.data.weekStart),
            201
        );
    } catch (failure) {
        return demoFailure("POST context demo", failure);
    }
}
