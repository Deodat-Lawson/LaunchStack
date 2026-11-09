import { NextResponse } from "next/server";
import { z } from "zod";
import {
    generateWeeklyReview,
    weeklyReviewEnabled,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError, requestKey } from "./_http";
export const maxDuration = 120;
export async function GET(request: Request) {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const week = new URL(request.url).searchParams.get("weekStart");
        const repository = weeklyReviewServices().repository;
        return NextResponse.json({
            enabled: weeklyReviewEnabled(),
            activeId:
                weeklyReviewEnabled() && week && /^\d{4}-\d{2}-\d{2}$/.test(week)
                    ? await repository.active(auth.actor, week)
                    : null,
            runs: weeklyReviewEnabled() ? await repository.list(auth.actor) : [],
        });
    } catch (error) {
        return reviewError(error);
    }
}
export async function POST(request: Request) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    try {
        const body = z
            .object({
                weekStart: z.string().date(),
                expectedActiveId: z.string().uuid().nullable(),
            })
            .strict()
            .parse(await request.json());
        return NextResponse.json(
            await generateWeeklyReview(auth.actor, { ...body, key: requestKey(request) }),
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_review_request" }, { status: 400 });
        return reviewError(error);
    }
}
