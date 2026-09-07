// GET  /api/distribution/programs — list the workspace's programs
// POST /api/distribution/programs — create a program (the partner profile to recruit against)
import type { NextRequest } from "next/server";

import { ProgramInputSchema } from "@launchstack/pipelines/distribution/types";
import { createProgram, listPrograms } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const programs = await listPrograms(ctx.data.companyId);
        return json({ programs });
    } catch (err) {
        return handleRouteError("GET programs", err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const parsed = ProgramInputSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        const program = await createProgram({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            input: parsed.data,
        });
        return json({ program }, 201);
    } catch (err) {
        return handleRouteError("POST programs", err);
    }
}
