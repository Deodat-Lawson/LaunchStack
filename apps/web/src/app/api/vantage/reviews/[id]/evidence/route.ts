import { NextResponse } from "next/server";
import { z } from "zod";
import {
    EvidenceInspectionSchema,
    inspectFrozenEvidence,
} from "~/server/vantage/weekly-review-evidence-inspection";
import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError } from "../../_http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const input = EvidenceInspectionSchema.parse({
            id: (await params).id,
            ref: new URL(request.url).searchParams.get("ref"),
        });
        const report = await weeklyReviewServices().repository.get(auth.actor, input.id);
        return NextResponse.json(inspectFrozenEvidence(report.evidence, input.ref));
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_evidence_request" }, { status: 400 });
        return reviewError(error);
    }
}
