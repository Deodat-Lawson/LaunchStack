// PATCH /api/brand/channels/[id] — { enabled }: offer the channel in Compose or not (admins)
import type { NextRequest } from "next/server";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { listBrandChannels } from "~/server/brand/accounts";
import { parseDeploymentChannelId, setChannelEnabled } from "~/server/brand/channels";

import { brandManageContext, brandT, error, handleBrandError, json, readBody } from "../../_http";

const PatchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandManageContext(request);
    if (!auth.ok) return auth.response;
    try {
        const t = brandT(request);
        const { id } = await params;
        if (parseDeploymentChannelId(id)) return error(t("deploymentAccount"), 400);
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(t("channelOnOff"), 400);
        const row = await setChannelEnabled(auth.ctx.companyId, id, parsed.data.enabled);
        if (!row) return error(t("channelNotFound"), 404);
        const channel = (
            await listBrandChannels(auth.ctx.companyId, undefined, localeOfRequest(request))
        ).find(c => c.id === id);
        return json({ channel });
    } catch (err) {
        return handleBrandError("PATCH channel", err, request);
    }
}
