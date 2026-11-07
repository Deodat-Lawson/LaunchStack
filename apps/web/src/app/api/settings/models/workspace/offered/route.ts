/**
 * The models a workspace offers in Ask's model menu, saved on their own from
 * Models & usage › Models. Gated on `models.manage`.
 *
 * The body is the whole list, in menu order. A model already offered keeps
 * its key (send it back); a new one gets a key here, which saved drafts and
 * turns then name it by. The address, key and route models are untouched —
 * they are API keys' to change — and a workspace without a main model there
 * has nothing to offer models beside, so the save is refused.
 */

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { offeredListProblem, settledOffered } from "~/server/workspace-models/config";
import { saveOfferedSchema } from "~/server/workspace-models/requests";
import { invalidateWorkspaceChatModels } from "~/server/workspace-models/scope";
import { getWorkspaceEndpointView, saveOfferedModels } from "~/server/workspace-models/store";
import { wordModels } from "~/server/workspace-models/words";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
    const ctx = await requireWorkspacePermission("models.manage");
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "settings.server.models");

    const parsed = saveOfferedSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: t("invalidSetup") }, { status: 400 });
    }
    const problem = offeredListProblem(parsed.data.offered);
    if (problem) return NextResponse.json({ error: wordModels(problem, locale) }, { status: 400 });

    try {
        const saved = await saveOfferedModels({
            companyId: ctx.data.companyId,
            userId: ctx.data.userPk,
            offered: settledOffered(parsed.data.offered),
        });
        if (!saved) {
            return NextResponse.json({ error: t("offeredNeedsModel") }, { status: 409 });
        }
    } catch (error) {
        console.error("[settings/models/workspace/offered] save failed:", error);
        return NextResponse.json({ error: t("saveFailed") }, { status: 500 });
    }

    invalidateWorkspaceChatModels(ctx.data.companyId);
    return NextResponse.json({ endpoint: await getWorkspaceEndpointView(ctx.data.companyId) });
}
