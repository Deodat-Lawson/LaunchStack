// GET  /api/vantage/commitments?status=open,missed — the promise ledger
// POST /api/vantage/commitments — one the founder makes outside a meeting
import type { NextRequest } from "next/server";

import {
    VANTAGE_COMMITMENT_STATUSES,
    createCommitment,
    listCommitments,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { CommitmentSchema } from "../_schemas";

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const statusParam = request.nextUrl.searchParams.get("status");
        const status = statusParam
            ? statusParam
                  .split(",")
                  .filter((s): s is (typeof VANTAGE_COMMITMENT_STATUSES)[number] =>
                      (VANTAGE_COMMITMENT_STATUSES as readonly string[]).includes(s)
                  )
            : undefined;
        const commitments = await listCommitments({ companyId: auth.ctx.companyId, status });
        return json({ commitments });
    } catch (err) {
        return handleVantageError("GET commitments", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = CommitmentSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const commitment = await createCommitment({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            input: parsed.data,
        });
        return json({ commitment }, 201);
    } catch (err) {
        return handleVantageError("POST commitment", err);
    }
}
