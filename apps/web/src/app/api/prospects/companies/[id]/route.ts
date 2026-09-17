// GET /api/prospects/companies/[id] — profile, evidence, people, deal
import type { NextRequest } from "next/server";

import { getCompany } from "~/server/prospects/service";

import { handleProspectsError, json, prospectsContext } from "../../_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ company: await getCompany(auth.ctx, id) });
    } catch (err) {
        return handleProspectsError("GET company", err);
    }
}
