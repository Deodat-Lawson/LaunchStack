import { NextResponse } from "next/server";
import { z } from "zod";
import { weeklyReviewEnabled, weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError, requestKey } from "../../_http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    if (!weeklyReviewEnabled())
        return NextResponse.json({ error: "weekly_review_disabled" }, { status: 404 });
    try {
        const body = z
            .object({ expectedActiveId: z.string().uuid().nullable() })
            .strict()
            .parse(await request.json());
        return NextResponse.json(
            await weeklyReviewServices().repository.restore(auth.actor, (await params).id, {
                ...body,
                key: requestKey(request),
            })
        );
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_restore_request" }, { status: 400 });
        return reviewError(error);
    }
}
