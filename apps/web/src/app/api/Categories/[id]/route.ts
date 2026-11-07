import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V } from "~/i18n/validation";
import { db } from "~/server/db";
import { category } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderError } from "~/server/folders";
import { folderErrorText } from "~/server/folders/words";
import { renameFolderAs } from "~/server/workspace/folder-actions";

const PatchCategorySchema = z.object({
    name: z.string().trim().min(1, V.nameCannotBeEmpty).max(256, V.nameTooLong),
});

function parseId(
    raw: string,
    request: Request
): { ok: true; id: number } | { ok: false; response: NextResponse } {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: requestTranslator(request, "sources.server.errors")("invalidCategoryId") },
                { status: 400 }
            ),
        };
    }
    return { ok: true, id };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.errors");
    try {
        const { id: rawId } = await context.params;
        const parsed = parseId(rawId, request);
        if (!parsed.ok) return parsed.response;

        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, PatchCategorySchema);
        if (!validation.success) {
            return validation.response;
        }
        const { name } = validation.data;

        const [existing] = await db
            .select({ name: category.name })
            .from(category)
            .where(and(eq(category.id, parsed.id), eq(category.companyId, ctx.data.companyId)));
        if (!existing) {
            return NextResponse.json({ error: t("categoryNotFound") }, { status: 404 });
        }
        if (existing.name === name) {
            return NextResponse.json({ success: true, id: parsed.id, name }, { status: 200 });
        }

        // The same rename as `PATCH /api/folders`: visible, managed by the
        // caller, its subtree follows, and a move never publishes (ADR-014).
        await renameFolderAs(ctx.data, existing.name, name);
        return NextResponse.json({ success: true, id: parsed.id, name }, { status: 200 });
    } catch (error) {
        if (error instanceof FolderError) {
            return NextResponse.json(
                {
                    error:
                        error.status === 404
                            ? t("categoryNotFound")
                            : folderErrorText(error, locale),
                },
                { status: error.status }
            );
        }
        console.error("[Categories PATCH] failed:", error);
        return NextResponse.json({ error: t("renameCategoryFailed") }, { status: 500 });
    }
}
