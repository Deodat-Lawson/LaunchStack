// POST /api/prospects/companies/exclude — { ids: string[], excluded: boolean }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { setExcluded } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../../_http";

const Schema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
    excluded: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success) return error("ids are required", 400);
        return json({
            updated: await setExcluded(auth.ctx, parsed.data.ids, parsed.data.excluded),
        });
    } catch (err) {
        return handleProspectsError("POST exclude", err);
    }
}
