import { NextResponse } from "next/server";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V } from "~/i18n/validation";
import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderError } from "~/server/folders";
import { folderErrorText } from "~/server/folders/words";
import { createFolderAs } from "~/server/workspace/folder-actions";

const AddCategorySchema = z.object({
    CategoryName: z.string().min(1, V.categoryNameRequired).max(256, V.categoryNameTooLong),
});

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    try {
        const validation = await validateRequestBody(request, AddCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        // The same create as `POST /api/folders`, with ADR-014's defaults.
        const created = await createFolderAs(ctx.data, validation.data.CategoryName);
        const [row] = await db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, ctx.data.companyId), eq(category.name, created.path)))
            .limit(1);

        return NextResponse.json({
            success: true,
            id: row ? { id: Number(row.id) } : null,
            name: created.path,
        });
    } catch (error: unknown) {
        if (error instanceof FolderError) {
            return NextResponse.json(
                { error: folderErrorText(error, locale) },
                { status: error.status }
            );
        }
        console.error("[Categories POST] failed:", error);
        return NextResponse.json(
            { error: translatorFor(locale, "sources.server.errors")("createCategoryFailed") },
            { status: 500 }
        );
    }
}
