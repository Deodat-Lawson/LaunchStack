// POST /api/distribution/import — existing partners as { programId, rows: [...] }
//
// Creates organisations and relationships (default stage "active") and adds
// their domains to the program's exclusion list, so discovery never pitches
// a partner the tenant already has (design §7, the worst failure).
import type { NextRequest } from "next/server";

import { ImportPartnersSchema } from "@launchstack/pipelines/distribution/types";
import { getProgram, importPartners } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

export async function POST(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const parsed = ImportPartnersSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        const program = await getProgram(parsed.data.programId, ctx.data.companyId);
        if (!program) return error("Program not found", 404);
        const result = await importPartners({
            companyId: ctx.data.companyId,
            programId: program.id,
            userId: ctx.data.authUserId,
            rows: parsed.data.rows,
        });
        return json({ created: result.created, existing: result.existing }, 201);
    } catch (err) {
        return handleRouteError("POST import", err);
    }
}
