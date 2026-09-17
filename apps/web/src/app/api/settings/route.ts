/**
 * The one settings API.
 *
 * GET resolves every registered setting for the caller (optionally against a
 * folder, for folder overrides). PUT writes one value at one scope, or resets
 * it. Validation, scope rules, permissions and the audit row all live in the
 * store, so this route is only auth plus a body parser — which is what makes
 * a settings change impossible to make in a shape the panel could not.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { loadSettings, writeSetting } from "~/server/settings/store";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

const WriteSchema = z
    .object({
        key: z.string().min(1).max(128),
        scope: z.enum(["workspace", "folder", "member"]),
        scopeId: z.string().max(256).nullable().optional(),
        value: z.unknown().optional(),
        reset: z.boolean().optional(),
    })
    .refine(body => body.reset === true || body.value !== undefined, {
        message: "Send a value, or reset: true",
    });

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        const folder = new URL(request.url).searchParams.get("folder");
        const payload = await loadSettings(ctx.data, {
            folderPath: folder?.trim() ? folder.trim() : null,
        });
        return NextResponse.json(payload);
    } catch (error) {
        return workspaceErrorResponse(error, "[settings GET]");
    }
}

export async function PUT(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, WriteSchema);
    if (!body.success) return body.response;
    try {
        const resolved = await writeSetting(ctx.data, body.data);
        return NextResponse.json({ setting: resolved });
    } catch (error) {
        return workspaceErrorResponse(error, "[settings PUT]");
    }
}
