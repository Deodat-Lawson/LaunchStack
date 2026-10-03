/**
 * GET /api/company/metadata
 *
 * The raw company-metadata JSON for the logged-in user's company — the
 * export of what the company profile builder wrote. The profile screen and
 * its edits use /api/company/profile.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { companyMetadata } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const [result] = await db
            .select({
                metadata: companyMetadata.metadata,
                schemaVersion: companyMetadata.schemaVersion,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, ctx.data.companyId));

        if (!result) {
            return NextResponse.json({
                metadata: null,
                message: "No company profile yet. Build it from Settings › Company.",
            });
        }

        return NextResponse.json({
            metadata: result.metadata,
            schemaVersion: result.schemaVersion,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
        });
    } catch (error) {
        console.error("[company-metadata] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
