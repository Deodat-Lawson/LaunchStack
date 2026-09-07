// PATCH /api/distribution/agreements/[id]
import type { NextRequest } from "next/server";

import { AgreementInputSchema } from "@launchstack/pipelines/distribution/types";
import { updateAgreement } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const parsed = AgreementInputSchema.partial().safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        const agreement = await updateAgreement(id, ctx.data.companyId, parsed.data);
        if (!agreement) return error("Not found", 404);
        return json({ agreement });
    } catch (err) {
        return handleRouteError("PATCH agreement", err);
    }
}
