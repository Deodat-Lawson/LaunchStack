/**
 * The workspace's own model endpoint: read it, save it, disconnect it.
 * Gated on `settings.manage`, like the deployment's model overview next door.
 *
 * The key goes in and never comes back out: reads return `hasKey` and the last
 * four characters. The address and model ids the admin entered are theirs and
 * are shown back to them — unlike the deployment's, which stay on the server.
 */

import { NextResponse } from "next/server";

import { MissingSecretsKeyError } from "@launchstack/store/crypto";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { selectionProblem } from "~/server/workspace-models/config";
import {
    WorkspaceEndpointUrlError,
    assertEndpointUrlAllowed,
} from "~/server/workspace-models/endpoint-url";
import { saveEndpointSchema } from "~/server/workspace-models/requests";
import { invalidateWorkspaceChatModels } from "~/server/workspace-models/scope";
import {
    KeyNeededForNewAddressError,
    NO_SECRETS_KEY_MESSAGE,
    deleteWorkspaceEndpoint,
    getWorkspaceEndpointView,
    saveWorkspaceEndpoint,
} from "~/server/workspace-models/store";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { wordModels } from "~/server/workspace-models/words";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    return NextResponse.json({ endpoint: await getWorkspaceEndpointView(ctx.data.companyId) });
}

export async function PUT(request: Request) {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "settings.server.models");

    const parsed = saveEndpointSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: t("invalidSetup") }, { status: 400 });
    }
    const body = parsed.data;

    if (body.models) {
        const problem = selectionProblem(body.models);
        if (problem)
            return NextResponse.json({ error: wordModels(problem, locale) }, { status: 400 });
    }

    try {
        const baseUrl = await assertEndpointUrlAllowed(body.baseUrl);
        await saveWorkspaceEndpoint({
            companyId: ctx.data.companyId,
            userId: ctx.data.userPk,
            provider: body.provider,
            baseUrl,
            apiKey: body.apiKey,
            models: body.models,
            connectedVia: body.provider === "openrouter" ? "openrouter" : "key",
        });
    } catch (error) {
        if (
            error instanceof WorkspaceEndpointUrlError ||
            error instanceof KeyNeededForNewAddressError
        ) {
            return NextResponse.json({ error: wordModels(error.message, locale) }, { status: 400 });
        }
        if (error instanceof MissingSecretsKeyError) {
            return NextResponse.json(
                { error: wordModels(NO_SECRETS_KEY_MESSAGE, locale) },
                { status: 503 }
            );
        }
        console.error("[settings/models/workspace] save failed:", error);
        return NextResponse.json({ error: t("saveFailed") }, { status: 500 });
    }

    invalidateWorkspaceChatModels(ctx.data.companyId);
    return NextResponse.json({ endpoint: await getWorkspaceEndpointView(ctx.data.companyId) });
}

export async function DELETE() {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    await deleteWorkspaceEndpoint(ctx.data.companyId);
    invalidateWorkspaceChatModels(ctx.data.companyId);
    return NextResponse.json({ endpoint: null });
}
