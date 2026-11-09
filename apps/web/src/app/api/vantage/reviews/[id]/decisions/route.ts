import { NextResponse } from "next/server";
import { z } from "zod";
import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError, requestKey } from "../../_http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    try {
        const body = z
            .object({
                expectedVersion: z.number().int().positive(),
                topicId: z.string().min(1).max(100),
                decision: z.string().trim().min(1).max(2000),
                outcome: z.string().trim().min(1).max(2000).optional(),
            })
            .strict()
            .parse(await request.json());
        const version = await weeklyReviewServices().repository.decide(
            auth.actor,
            (await params).id,
            { ...body, key: requestKey(request) }
        );
        return NextResponse.json({ version });
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_review_decision" }, { status: 400 });
        return reviewError(error);
    }
}
