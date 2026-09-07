/**
 * GET /api/Categories/GetCategories
 *
 * The folders a member may see. Every `documents.read` holder gets the list,
 * filtered to their `DocumentScope`, and each row says whether the folder is
 * restricted so the picker can badge it.
 */
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { category } from "@launchstack/store/schema";
import { folderSettings } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";

export async function GET(_request: Request) {
    try {
        const ctx = await requireWorkspacePermission("documents.read");
        if (!ctx.success) return ctx.response;

        const [rows, scope] = await Promise.all([
            db
                .select({
                    id: category.id,
                    name: category.name,
                    companyId: category.companyId,
                    createdAt: category.createdAt,
                    updatedAt: category.updatedAt,
                    visibility: folderSettings.visibility,
                })
                .from(category)
                .leftJoin(folderSettings, eq(folderSettings.categoryId, category.id))
                .where(eq(category.companyId, ctx.data.companyId)),
            ctx.data.documentScope(),
        ]);

        // Convert BigInt fields to numbers for JSON serialization
        const serializedCategories = rows
            .filter(row => scopeAllowsCategory(scope, row.name))
            .map(row => ({
                id: Number(row.id),
                name: row.name,
                companyId: Number(row.companyId),
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                restricted: row.visibility === "restricted",
            }));

        return NextResponse.json(serializedCategories, { status: 200 });
    } catch (error: unknown) {
        console.error("Error fetching categories:", error);
        return NextResponse.json({ error: "Unable to fetch categories" }, { status: 500 });
    }
}
