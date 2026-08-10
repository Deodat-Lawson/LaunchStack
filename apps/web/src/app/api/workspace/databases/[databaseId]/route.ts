import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { workspaceDatabases } from "~/server/db/schema/workspace";
import {
    getDatabase,
    listDatabaseRows,
    serializeDatabase,
    serializePage,
} from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const UpdateDatabaseSchema = z.object({
    title: z.string().max(2000).optional(),
    description: z.string().max(5000).nullish(),
    icon: z
        .object({ type: z.enum(["emoji", "image"]), value: z.string() })
        .nullish(),
    /** Whole-array replacement: the client owns ordering and ids. */
    properties: z.array(z.record(z.unknown())).optional(),
    views: z.array(z.record(z.unknown())).optional(),
    isInline: z.boolean().optional(),
});

/** The database definition plus its rows, which are pages. */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ databaseId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { databaseId } = await params;
        const database = await getDatabase(session.userId, databaseId);
        if (!database) {
            return NextResponse.json({ error: "Database not found" }, { status: 404 });
        }

        const rows = await listDatabaseRows(session.userId, databaseId);

        return NextResponse.json(
            {
                database: serializeDatabase(database),
                rows: rows.map(serializePage),
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/databases/:id] GET failed:", error);
        return NextResponse.json({ error: "Failed to load database" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ databaseId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { databaseId } = await params;
        const validation = await validateRequestBody(request, UpdateDatabaseSchema);
        if (!validation.success) return validation.response;

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        for (const key of ["title", "description", "icon", "properties", "views", "isInline"] as const) {
            if (validation.data[key] !== undefined) patch[key] = validation.data[key];
        }

        const [database] = await db
            .update(workspaceDatabases)
            .set(patch)
            .where(
                and(
                    eq(workspaceDatabases.id, databaseId),
                    eq(workspaceDatabases.userId, session.userId)
                )
            )
            .returning();

        if (!database) {
            return NextResponse.json({ error: "Database not found" }, { status: 404 });
        }

        return NextResponse.json(
            { database: serializeDatabase(database) },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/databases/:id] PATCH failed:", error);
        return NextResponse.json({ error: "Failed to update database" }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ databaseId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { databaseId } = await params;
        const deleted = await db
            .delete(workspaceDatabases)
            .where(
                and(
                    eq(workspaceDatabases.id, databaseId),
                    eq(workspaceDatabases.userId, session.userId)
                )
            )
            .returning({ id: workspaceDatabases.id });

        if (deleted.length === 0) {
            return NextResponse.json({ error: "Database not found" }, { status: 404 });
        }

        return NextResponse.json({ deleted: databaseId }, { status: 200 });
    } catch (error) {
        console.error("[workspace/databases/:id] DELETE failed:", error);
        return NextResponse.json({ error: "Failed to delete database" }, { status: 500 });
    }
}
