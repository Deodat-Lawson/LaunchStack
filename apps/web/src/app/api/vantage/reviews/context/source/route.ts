import { NextResponse } from "next/server";
import { z } from "zod";
import {
    ContextSourceInspectionSchema,
    inspectContextSource,
} from "~/server/vantage/weekly-review-evidence-inspection";
import { weeklyReviewDatabase } from "~/server/vantage/weekly-review-service";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
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
                async () => {
                    const current = await reviewActor();
                    if (!current.ok) throw new WeeklyReviewConflict("review_access_denied", 403);
                    return {
                        ...current.actor,
                        role: current.ctx.role,
                        canRead: current.ctx.can("documents.read"),
                        canMutate: current.ctx.can("documents.edit"),
                        canConfigure: current.ctx.can("settings.manage"),
                        documentScope: await current.ctx.documentScope(),
                    };
                },
                input
            )
        );
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_source_inspection" }, { status: 400 });
        return reviewError(error);
    }
}
