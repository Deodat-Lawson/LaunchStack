// PATCH /api/brand/channels/[id] — { enabled }: offer the channel in Compose or not (admins)
import type { NextRequest } from "next/server";
import { z } from "zod";

import { listBrandChannels } from "~/server/brand/accounts";
import { parseDeploymentChannelId, setChannelEnabled } from "~/server/brand/channels";

import { brandManageContext, error, handleBrandError, json, readBody } from "../../_http";

const PatchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandManageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        if (parseDeploymentChannelId(id))
            return error("The deployment's account is set by the operator.", 400);
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Say whether the channel is on or off", 400);
        const row = await setChannelEnabled(auth.ctx.companyId, id, parsed.data.enabled);
        if (!row) return error("Channel not found", 404);
        const channel = (await listBrandChannels(auth.ctx.companyId)).find(c => c.id === id);
        return json({ channel });
    } catch (err) {
        return handleBrandError("PATCH channel", err);
    }
}
