// POST   /api/brand/accounts/[platform] — { values } verify with the network, then store sealed
// DELETE /api/brand/accounts/[platform] — forget this workspace's credential
//
// Connecting an account lets the workspace speak in public under that name,
// so it takes the same permission as connecting a data source.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import {
    BrandAccountError,
    connectBrandAccount,
    disconnectBrandAccount,
    isBrandPlatform,
} from "~/server/brand/accounts";

import { error, handleBrandError, json, readBody } from "../../_http";

const Schema = z.object({
    values: z.record(z.string().max(4096)).default({}),
});

async function adminContext() {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false as const, response: result.response };
    if (!result.data.can("connectors.manage"))
        return {
            ok: false as const,
            response: error("The connectors.manage permission is required", 403),
        };
    return { ok: true as const, ctx: result.data };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ platform: string }> }
) {
    const auth = await adminContext();
    if (!auth.ok) return auth.response;
    const { platform } = await params;
    if (!isBrandPlatform(platform)) return error("Unknown network", 404);
    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `brand-connect:${auth.ctx.authUserId}`,
        },
        async () => {
            try {
                const parsed = Schema.safeParse(await readBody(request));
                if (!parsed.success) return error("Check the values and try again", 400);
                const account = await connectBrandAccount({
                    companyId: auth.ctx.companyId,
                    userId: auth.ctx.authUserId,
                    platform,
                    values: parsed.data.values,
                });
                return json({ account }, 201);
            } catch (err) {
                if (err instanceof BrandAccountError)
                    return error(err.message, err.status, { code: err.code });
                return handleBrandError("POST account", err);
            }
        }
    );
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ platform: string }> }
) {
    const auth = await adminContext();
    if (!auth.ok) return auth.response;
    try {
        const { platform } = await params;
        if (!isBrandPlatform(platform)) return error("Unknown network", 404);
        return json({ account: await disconnectBrandAccount(auth.ctx.companyId, platform) });
    } catch (err) {
        return handleBrandError("DELETE account", err);
    }
}
