/**
 * A file's public link (ADR-016), for the Share dialog.
 *
 * GET    — the live link (or null), whether the caller may change it, and the
 *          workspace switch. Anyone who can open the file may read it.
 * POST   — make the link (or return the live one). Manage on the file.
 * PATCH  — change download / expiry. Manage on the file.
 * DELETE — turn it off. Manage on the file.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    parseValue,
    readOptionalJson,
    requestOrigin,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import {
    createPublicLink,
    isPublicLinkExpiryDays,
    type PublicLinkExpiryDays,
    getPublicLinkState,
    revokePublicLink,
    updatePublicLink,
} from "~/server/workspace/public-links";

type Params = { params: Promise<{ documentId: string }> };

const PublicLinkInputSchema = z
    .object({
        allowDownload: z.boolean().optional(),
        expiresInDays: z
            .custom<PublicLinkExpiryDays>(isPublicLinkExpiryDays, {
                message: "expiresInDays must be null, 7 or 30",
            })
            .optional(),
    })
    .strict();

export async function GET(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse(request);
    try {
        return NextResponse.json(await getPublicLinkState(ctx.data, id, requestOrigin(request)));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/public-link GET]", request);
    }
}

export async function POST(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse(request);
    const body = parseValue(await readOptionalJson(request), PublicLinkInputSchema, request);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(
            await createPublicLink(ctx.data, id, body.data, requestOrigin(request))
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/public-link POST]", request);
    }
}

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse(request);
    const body = await parseJsonBody(request, PublicLinkInputSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(
            await updatePublicLink(ctx.data, id, body.data, requestOrigin(request))
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/public-link PATCH]", request);
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse(request);
    try {
        return NextResponse.json(
            await revokePublicLink(ctx.data, id, requestOrigin(request))
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/public-link DELETE]", request);
    }
}
