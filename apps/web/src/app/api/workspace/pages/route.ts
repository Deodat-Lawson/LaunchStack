import { NextResponse } from "next/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { createPage, listPages, serializePage } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const IconSchema = z
    .object({
        type: z.enum(["emoji", "image"]),
        value: z.string(),
    })
    .nullable();

const CoverSchema = z
    .object({
        type: z.enum(["gradient", "image"]),
        value: z.string(),
        position: z.number().min(0).max(100),
    })
    .nullable();

const CreatePageSchema = z.object({
    id: z.string().uuid().optional(),
    parentPageId: z.string().uuid().nullish(),
    parentType: z.enum(["workspace", "page", "database"]).optional(),
    databaseId: z.string().uuid().nullish(),
    title: z.string().max(2000).optional(),
    icon: IconSchema.optional(),
    cover: CoverSchema.optional(),
    content: z.unknown().optional(),
    properties: z.record(z.unknown()).nullish(),
    isTemplate: z.boolean().optional(),
});

/** The whole page tree as sidebar summaries. */
export async function GET(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const includeTrash =
            new URL(request.url).searchParams.get("includeTrash") === "true";
        const pages = await listPages(session.userId, { includeTrash });

        return NextResponse.json({ pages }, { status: 200 });
    } catch (error) {
        console.error("[workspace/pages] GET failed:", error);
        return NextResponse.json({ error: "Failed to load pages" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const validation = await validateRequestBody(request, CreatePageSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const page = await createPage(session.userId, session.companyId, {
            id: body.id,
            parentPageId: body.parentPageId ?? null,
            parentType: body.parentType,
            databaseId: body.databaseId ?? null,
            title: body.title,
            icon: body.icon ?? null,
            cover: body.cover ?? null,
            content: body.content,
            properties: body.properties ?? null,
            isTemplate: body.isTemplate,
        });

        return NextResponse.json({ page: serializePage(page) }, { status: 201 });
    } catch (error) {
        console.error("[workspace/pages] POST failed:", error);
        return NextResponse.json({ error: "Failed to create page" }, { status: 500 });
    }
}
