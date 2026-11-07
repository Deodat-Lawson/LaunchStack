// POST /api/distribution/import — existing partners as { programId, rows: [...] }
//
// Creates organisations and relationships (default stage "active") and adds
// their domains to the program's exclusion list, so discovery never pitches
// a partner the tenant already has (design §7, the worst failure).
import type { NextRequest } from "next/server";

import { ImportPartnersSchema } from "@launchstack/pipelines/distribution/types";
import { getProgram, importPartners } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");
const growth = (request: Request) => requestTranslator(request, "growth.server.errors");

export async function POST(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const parsed = ImportPartnersSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error(api(request)("validationFailed"), 400, {
                details: parsed.error.flatten(),
            });
        const program = await getProgram(parsed.data.programId, ctx.data.companyId);
        if (!program) return error(growth(request)("programNotFound"), 404);
        const result = await importPartners({
            companyId: ctx.data.companyId,
            programId: program.id,
            userId: ctx.data.authUserId,
            rows: parsed.data.rows,
        });
        return json({ created: result.created, existing: result.existing }, 201);
    } catch (err) {
        return distributionRouteError("POST import", err, request);
    }
}
