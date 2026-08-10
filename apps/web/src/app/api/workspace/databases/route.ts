import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import {
    workspaceDatabases,
    type DatabaseProperty,
    type DatabaseView,
} from "~/server/db/schema/workspace";
import { createPage, serializeDatabase } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const CreateDatabaseSchema = z.object({
    id: z.string().uuid().optional(),
    pageId: z.string().uuid(),
    title: z.string().max(2000).optional(),
    isInline: z.boolean().optional(),
    /** `table` unless the caller asks for another starting view. */
    viewType: z
        .enum(["table", "board", "list", "gallery", "calendar", "timeline"])
        .optional(),
    /** Seed the database with this many blank rows. */
    seedRows: z.number().int().min(0).max(20).optional(),
});

/**
 * A fresh database mirrors Notion's: a Name title column plus Tags and Date,
 * one view, and three empty rows so the grid is not an intimidating blank.
 */
function starterProperties(): DatabaseProperty[] {
    return [
        { id: "title", name: "Name", type: "title", isTitle: true, width: 260 },
        {
            id: randomUUID(),
            name: "Tags",
            type: "multi_select",
            options: [
                { id: randomUUID(), name: "Idea", color: "blue" },
                { id: randomUUID(), name: "Draft", color: "yellow" },
                { id: randomUUID(), name: "Done", color: "green" },
            ],
            width: 180,
        },
        { id: randomUUID(), name: "Date", type: "date", width: 160 },
    ];
}

function starterView(
    type: DatabaseView["type"],
    properties: DatabaseProperty[]
): DatabaseView {
    const groupable = properties.find(
        (p) => p.type === "select" || p.type === "multi_select" || p.type === "status"
    );
    const dateProperty = properties.find((p) => p.type === "date");

    return {
        id: randomUUID(),
        name: type === "table" ? "Table" : type[0]!.toUpperCase() + type.slice(1),
        type,
        filters: [],
        filterConjunction: "and",
        sorts: [],
        groupByPropertyId: groupable?.id,
        datePropertyId: dateProperty?.id,
        visiblePropertyIds: properties.map((p) => p.id),
        cardPreview: "cover",
        cardSize: "medium",
        wrapCells: false,
    };
}

export async function POST(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const validation = await validateRequestBody(request, CreateDatabaseSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const properties = starterProperties();
        const id = body.id ?? randomUUID();

        const [database] = await db
            .insert(workspaceDatabases)
            .values({
                id,
                userId: session.userId,
                companyId: session.companyId,
                pageId: body.pageId,
                title: body.title ?? "Untitled",
                properties,
                views: [starterView(body.viewType ?? "table", properties)],
                isInline: body.isInline ?? true,
            })
            .returning();

        if (!database) {
            return NextResponse.json({ error: "Failed to create database" }, { status: 500 });
        }

        for (let i = 0; i < (body.seedRows ?? 3); i += 1) {
            await createPage(session.userId, session.companyId, {
                parentPageId: body.pageId,
                parentType: "database",
                databaseId: id,
                title: "",
                properties: {},
            });
        }

        return NextResponse.json(
            { database: serializeDatabase(database) },
            { status: 201 }
        );
    } catch (error) {
        console.error("[workspace/databases] POST failed:", error);
        return NextResponse.json({ error: "Failed to create database" }, { status: 500 });
    }
}
