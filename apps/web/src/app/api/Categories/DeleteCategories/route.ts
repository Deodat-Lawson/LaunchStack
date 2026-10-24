/**
 * DELETE /api/Categories/DeleteCategories { id } — the legacy, id-addressed
 * twin of `DELETE /api/folders`. It runs through the same rules
 * (`~/server/workspace/folder-actions`): a folder the caller can't see is
 * "not found", deleting needs manage on it, and restrictions inside it are
 * carried onto the documents it re-homes (ADR-014).
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V } from "~/i18n/validation";
import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderError } from "~/server/folders";
import { folderErrorText } from "~/server/folders/words";
import { deleteFolderAs } from "~/server/workspace/folder-actions";

const DeleteCategorySchema = z.object({
    id: z.number().int().positive(V.categoryIdPositive),
});

export async function DELETE(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.errors");
    try {
        const validation = await validateRequestBody(request, DeleteCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const [row] = await db
            .select({ name: category.name })
            .from(category)
            .where(
                and(
                    eq(category.id, Number(validation.data.id)),
                    eq(category.companyId, ctx.data.companyId)
                )
            )
            .limit(1);
        if (!row) return NextResponse.json({ error: t("categoryNotFoundPeriod") }, { status: 404 });

        await deleteFolderAs(ctx.data, row.name);
        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: unknown) {
        if (error instanceof FolderError) {
            return NextResponse.json(
                {
                    error:
                        error.status === 404
                            ? t("categoryNotFoundPeriod")
                            : folderErrorText(error, locale),
                },
                { status: error.status }
            );
        }
        console.error("[Categories DELETE] failed:", error);
        return NextResponse.json({ error: t("deleteCategoryFailed") }, { status: 500 });
    }
}
