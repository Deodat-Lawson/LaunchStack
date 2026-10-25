/**
 * The model ids an endpoint lists, to fill the model pickers. Optional for
 * the admin: a server that doesn't list its models still works with a typed
 * id. Gated on `settings.manage`.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { WorkspaceEndpointUrlError } from "~/server/workspace-models/endpoint-url";
import { EndpointProbeError, listEndpointModels } from "~/server/workspace-models/probe";
import {
    StoredKeyMismatchError,
    listModelsSchema,
    resolveCandidate,
} from "~/server/workspace-models/requests";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { wordModels } from "~/server/workspace-models/words";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "settings.server.models");

    const parsed = listModelsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: t("enterEndpointFirst") }, { status: 400 });
    }

    try {
        const candidate = await resolveCandidate(ctx.data.companyId, parsed.data);
        return NextResponse.json({ models: await listEndpointModels(candidate) });
    } catch (error) {
        if (error instanceof WorkspaceEndpointUrlError || error instanceof StoredKeyMismatchError) {
            return NextResponse.json({ error: wordModels(error.message, locale) }, { status: 400 });
        }
        if (error instanceof EndpointProbeError) {
            return NextResponse.json(
                { error: wordModels(error.message, locale) },
                { status: error.status }
            );
        }
        console.error("[settings/models/workspace/models] failed:", error);
        return NextResponse.json({ error: t("listFailed") }, { status: 500 });
    }
}
