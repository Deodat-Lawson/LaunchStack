import { NextResponse } from "next/server";
import { z } from "zod";
import {
    ContextSourceInspectionSchema,
    inspectContextSource,
} from "~/server/vantage/weekly-review-evidence-inspection";
import {
    loadWeeklyReviewActor,
    weeklyReviewDatabase,
} from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError } from "../../_http";

export async function GET(request: Request) {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const input = ContextSourceInspectionSchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
        );
        return NextResponse.json(
            await inspectContextSource(
                weeklyReviewDatabase,
                auth.actor,
                loadWeeklyReviewActor,
                input
            )
        );
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_source_inspection" }, { status: 400 });
        return reviewError(error);
    }
}
