import { NextResponse } from "next/server";
import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError } from "../../_http";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    try {
        return NextResponse.json(
            await weeklyReviewServices().repository.expireUncertain(auth.actor, (await params).id)
        );
    } catch (error) {
        return reviewError(error);
    }
}
