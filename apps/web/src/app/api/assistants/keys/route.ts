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
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import { V } from "~/i18n/validation";

export const runtime = "nodejs";

const CreateKeySchema = z.object({
    name: z.string().trim().min(1, V.keyNameRequired).max(ACCESS_KEY_NAME_MAX),
    access: z.enum(["read", "read-write"]),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const body = await parseJsonBody(request, CreateKeySchema);
        if (!body.success) return body.response;

        const locale = localeOfRequest(request);
        const t = translatorFor(locale, "settings.server.errors");
        if (body.data.access === "read-write" && !ctx.data.can("documents.upload")) {
            return forbiddenForPermission("documents.upload", locale);
        }
        if (!mcpAvailability().enabled) {
            return NextResponse.json({ error: t("assistantServerOffKey") }, { status: 409 });
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
                const words = wordEnglish(error.message, "settings.server.errors", locale);
                return NextResponse.json({ error: words }, { status: 409 });
            }
            console.error("[assistants keys POST] failed:", error);
            return NextResponse.json({ error: t("keyCreateFailed") }, { status: 500 });
        }
    });
}
