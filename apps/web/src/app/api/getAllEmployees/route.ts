import { NextResponse } from "next/server";
import { db } from "../../../server/db/index";
import { users } from "@launchstack/core/db/schema";
import {eq, and } from "drizzle-orm";
import * as console from "console";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;

        const docs = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.companyId, companyId),
                )
            );

        // Convert BigInt fields to numbers for JSON serialization
        const serializedDocs = docs.map((doc) => ({
            ...doc,
            id: Number(doc.id),
            companyId: Number(doc.companyId),
        }));

        return NextResponse.json(serializedDocs, { status: 200 });
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json(
            { error: "Unable to fetch documents" },
            { status: 500 }
        );
    }
}
