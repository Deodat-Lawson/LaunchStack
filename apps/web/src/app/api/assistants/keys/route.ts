/**
 * Create an access key for the MCP server.
 *
 * POST `{ name, access }` — any active member, for themselves, in the active
 * workspace. `read-write` (search, read and save conversations) needs
 * `documents.upload`, the same permission saving a conversation needs, so a
 * Viewer can never mint a key that saves. Returns the secret once; only its
 * hash is kept.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { forbiddenForPermission, requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    ACCESS_KEY_NAME_MAX,
    AccessKeyLimitError,
    createAccessKey,
} from "~/server/mcp/access-keys";
import { mcpAvailability } from "~/server/mcp/config";
import { parseJsonBody } from "~/server/workspace/http";

export const runtime = "nodejs";

const CreateKeySchema = z.object({
    name: z.string().trim().min(1, "Give the key a name").max(ACCESS_KEY_NAME_MAX),
    access: z.enum(["read", "read-write"]),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const body = await parseJsonBody(request, CreateKeySchema);
        if (!body.success) return body.response;

        if (body.data.access === "read-write" && !ctx.data.can("documents.upload")) {
            return forbiddenForPermission("documents.upload");
        }
        if (!mcpAvailability().enabled) {
            return NextResponse.json(
                { error: "The assistant server is off, so a key would not work." },
                { status: 409 }
            );
        }

        try {
            const { key, secret } = await createAccessKey({
                companyId: ctx.data.companyId,
                userPk: ctx.data.userPk,
                name: body.data.name,
                access: body.data.access,
            });
            return NextResponse.json({ key, secret }, { status: 201 });
        } catch (error) {
            if (error instanceof AccessKeyLimitError) {
                return NextResponse.json({ error: error.message }, { status: 409 });
            }
            console.error("[assistants keys POST] failed:", error);
            return NextResponse.json({ error: "Could not create the key." }, { status: 500 });
        }
    });
}
