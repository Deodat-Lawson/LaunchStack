import type { NextRequest } from "next/server";
import { z } from "zod";
import { reviewEnhancement } from "@launchstack/pipelines/vantage";
import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
} from "../../../../_http";

const schema = z.object({
    status: z.enum(["accepted", "dismissed"]),
    baseTopicVersion: z.number().int().positive(),
});
type Params = { params: Promise<{ id: string; enhancementId: string }> };
export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id, enhancementId } = await params,
            parsed = schema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        return json(
            await reviewEnhancement(
                auth.ctx.companyId,
                id,
                enhancementId,
                parsed.data.status,
                parsed.data.baseTopicVersion
            )
        );
    } catch (err) {
        return handleVantageError("PATCH enhancement", err);
    }
}
