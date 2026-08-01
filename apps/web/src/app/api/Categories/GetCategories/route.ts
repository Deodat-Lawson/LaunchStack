import { NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { category } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import * as console from "console";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET(_request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (ctx.data.role !== "employer" && ctx.data.role !== "owner") {
            return NextResponse.json(
                { error: "Invalid user role." },
                { status: 400 }
            );
        }

        const categories = await db
            .select()
            .from(category)
            .where(eq(category.companyId, ctx.data.companyId));
            
        // Convert BigInt fields to numbers for JSON serialization
        const serializedCategories = categories.map((category) => ({
            ...category,
            id: Number(category.id),
            companyId: Number(category.companyId),
        }));

        return NextResponse.json(serializedCategories, { status: 200 });
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json(
            { error: "Unable to fetch documents" },
            { status: 500 }
        );
    }
}
