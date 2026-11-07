// GET  /api/distribution/programs — list the workspace's programs
// POST /api/distribution/programs — create a program (the partner profile to recruit against)
import type { NextRequest } from "next/server";

import { ProgramInputSchema } from "@launchstack/pipelines/distribution/types";
import { createProgram, listPrograms } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const programs = await listPrograms(ctx.data.companyId);
        return json({ programs });
    } catch (err) {
        return distributionRouteError("GET programs", err, request);
    }
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const parsed = ProgramInputSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error(api(request)("validationFailed"), 400, {
                details: parsed.error.flatten(),
            });
        const program = await createProgram({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            input: parsed.data,
        });
        return json({ program }, 201);
    } catch (err) {
        return distributionRouteError("POST programs", err, request);
    }
}
