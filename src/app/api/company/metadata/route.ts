/**
 * GET /api/company/metadata
 *
 * Returns the stored company metadata for the logged-in user's company.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { companyMetadata } from "~/server/db/schema/company-metadata";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 400 },
            );
        }

        const [result] = await db
            .select({
                metadata: companyMetadata.metadata,
                schemaVersion: companyMetadata.schemaVersion,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, userInfo.companyId));

        if (!result) {
            return NextResponse.json({
                metadata: null,
                message: "No metadata found. Upload documents and run extraction first.",
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
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
