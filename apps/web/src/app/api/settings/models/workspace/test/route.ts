/**
 * Send each chosen model one short message through the real chat transport,
 * before anything is saved. Gated on `models.manage`.
 */

import { NextResponse } from "next/server";

import { ChatConfigurationError } from "@launchstack/llm";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { settledSelection } from "~/server/workspace-models/config";
import { WorkspaceEndpointUrlError } from "~/server/workspace-models/endpoint-url";
import { testEndpoint } from "~/server/workspace-models/probe";
import {
    StoredKeyMismatchError,
    resolveCandidate,
    testEndpointSchema,
} from "~/server/workspace-models/requests";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { wordModels } from "~/server/workspace-models/words";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("models.manage");
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "settings.server.models");

    const parsed = testEndpointSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: t("chooseModel") }, { status: 400 });
    }

    try {
        const candidate = await resolveCandidate(ctx.data.companyId, parsed.data);
        // A test prices nothing: a price it couldn't use is left off, and
        // checked when the setup is saved.
        const results = await testEndpoint(candidate, settledSelection(parsed.data.models), locale);
        return NextResponse.json({
            ok: results.every(result => result.ok),
            results: results.map(result =>
                result.message ? { ...result, message: wordModels(result.message, locale) } : result
            ),
        });
    } catch (error) {
        if (
            error instanceof WorkspaceEndpointUrlError ||
            error instanceof StoredKeyMismatchError ||
            error instanceof ChatConfigurationError
        ) {
            return NextResponse.json({ error: wordModels(error.message, locale) }, { status: 400 });
        }
        console.error("[settings/models/workspace/test] failed:", error);
        return NextResponse.json({ error: t("testFailed") }, { status: 500 });
    }
}
