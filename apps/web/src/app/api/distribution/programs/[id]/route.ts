// GET   /api/distribution/programs/[id]
// PATCH /api/distribution/programs/[id]
import type { NextRequest } from "next/server";

import { ProgramPatchSchema } from "@launchstack/pipelines/distribution/types";
import { getProgram, updateProgram } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const program = await getProgram(id, ctx.data.companyId);
        if (!program) return error(api(request)("notFound"), 404);
        return json({ program });
    } catch (err) {
        return distributionRouteError("GET program", err, request);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const parsed = ProgramPatchSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error(api(request)("validationFailed"), 400, {
                details: parsed.error.flatten(),
            });
        const program = await updateProgram(id, ctx.data.companyId, parsed.data);
        if (!program) return error(api(request)("notFound"), 404);
        return json({ program });
    } catch (err) {
        return distributionRouteError("PATCH program", err, request);
    }
}
