/**
 * Send each chosen model one short message through the real chat transport,
 * before anything is saved. Gated on `settings.manage`.
 */

import { NextResponse } from "next/server";

import { ChatConfigurationError } from "@launchstack/llm";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { WorkspaceEndpointUrlError } from "~/server/workspace-models/endpoint-url";
import { testEndpoint } from "~/server/workspace-models/probe";
import {
    StoredKeyMismatchError,
    resolveCandidate,
    testEndpointSchema,
} from "~/server/workspace-models/requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;

    const parsed = testEndpointSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: "Choose a model to test." }, { status: 400 });
    }

    try {
        const candidate = await resolveCandidate(ctx.data.companyId, parsed.data);
        const results = await testEndpoint(candidate, parsed.data.models);
        return NextResponse.json({ ok: results.every(result => result.ok), results });
    } catch (error) {
        if (
            error instanceof WorkspaceEndpointUrlError ||
            error instanceof StoredKeyMismatchError ||
            error instanceof ChatConfigurationError
        ) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("[settings/models/workspace/test] failed:", error);
        return NextResponse.json({ error: "Couldn't run the test." }, { status: 500 });
    }
}
