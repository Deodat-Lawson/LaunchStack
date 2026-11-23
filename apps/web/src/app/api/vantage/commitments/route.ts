// GET  /api/vantage/commitments?status=open,missed — the promise ledger
// POST /api/vantage/commitments — one the founder makes outside a meeting
import type { NextRequest } from "next/server";

import {
    VANTAGE_COMMITMENT_STATUSES,
    createCommitment,
    listCommitments,
} from "@launchstack/pipelines/vantage";

import {
    authorizeLegacyCommitmentSource,
    filterLegacyCommitmentsRead,
} from "~/server/vantage/legacy-read-authority";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    say,
    vantageContext,
} from "../_http";
import { CommitmentSchema } from "../_schemas";

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.read"))
        return error(say(request, "legacySourceAccessUnavailable"), 403, {
            code: "legacy_report_forbidden",
        });
    try {
        const statusParam = request.nextUrl.searchParams.get("status");
        const status = statusParam
            ? statusParam
                  .split(",")
                  .filter((s): s is (typeof VANTAGE_COMMITMENT_STATUSES)[number] =>
                      (VANTAGE_COMMITMENT_STATUSES as readonly string[]).includes(s)
                  )
            : undefined;
        const commitments = await listCommitments({
            companyId: auth.ctx.companyId,
            viewer: {
                userId: auth.ctx.userId,
                canSeeProgramShares: auth.ctx.can("settings.manage"),
            },
            status,
        });
        return json({ commitments: await filterLegacyCommitmentsRead(auth.ctx, commitments) });
    } catch (err) {
        return handleVantageError("GET commitments", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const parsed = CommitmentSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues, request), 400);
        await authorizeLegacyCommitmentSource(auth.ctx, parsed.data);
        const commitment = await createCommitment({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            input: parsed.data,
            idempotencyKey: request.headers.get("Idempotency-Key") ?? "",
        });
        return json({ commitment }, 201);
    } catch (err) {
        return handleVantageError("POST commitment", err, request);
    }
}
