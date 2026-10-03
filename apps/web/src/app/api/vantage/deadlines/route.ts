// GET  /api/vantage/deadlines — program dates from a week ago onward
// POST /api/vantage/deadlines — add one (settings.manage: the program's side of the table)
import type { NextRequest } from "next/server";

import { addDays, createDeadline, listDeadlines, toIsoDate } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { DeadlineSchema } from "../_schemas";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const deadlines = await listDeadlines({
            companyId: auth.ctx.companyId,
            from: addDays(toIsoDate(new Date()), -7),
        });
        return json({ deadlines });
    } catch (err) {
        return handleVantageError("GET deadlines", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("settings.manage"))
        return error("Only a workspace admin can add program deadlines.", 403);
    try {
        const parsed = DeadlineSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const deadline = await createDeadline({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            input: parsed.data,
        });
        return json({ deadline }, 201);
    } catch (err) {
        return handleVantageError("POST deadline", err);
    }
}
