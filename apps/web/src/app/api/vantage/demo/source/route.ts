import type { NextRequest } from "next/server";
import {
    createVantageContextDemoService,
    assertVantageContextDemoEnabled,
} from "~/server/vantage/demo-service";
import { SourceQuerySchema, demoFailure, json } from "../_http";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const parsed = SourceQuerySchema.safeParse(
            Object.fromEntries(request.nextUrl.searchParams.entries())
        );
        if (!parsed.success) return json({ error: "Provide an exact source reference." }, 400);
        const { reportId, ...ref } = parsed.data;
        return json(await createVantageContextDemoService().source(reportId, ref));
    } catch (failure) {
        return demoFailure("GET context demo source", failure);
    }
}
