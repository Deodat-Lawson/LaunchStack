import type { NextRequest } from "next/server";
import { z } from "zod";

import { loadPendingQuestions, reviewPendingQuestion } from "~/server/vantage/pending-questions";
import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
} from "../../../_http";

const reviewSchema = z
    .object({
        questionId: z.string().trim().min(1).max(200),
        expectedVersion: z.number().int().nonnegative(),
        status: z.enum(["dismissed", "addressed"]),
        reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict();

type Params = { params: Promise<{ id: string }> };

function privateView(data: unknown) {
    const response = json(data);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return privateView(
            await loadPendingQuestions({
                companyId: auth.ctx.companyId,
                userId: auth.ctx.userId,
                agendaId: id,
            })
        );
    } catch (err) {
        return handleVantageError("GET pending historical questions", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = reviewSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        return privateView(
            await reviewPendingQuestion({
                companyId: auth.ctx.companyId,
                userId: auth.ctx.userId,
                agendaId: id,
                ...parsed.data,
            })
        );
    } catch (err) {
        return handleVantageError("PATCH pending historical question", err);
    }
}
