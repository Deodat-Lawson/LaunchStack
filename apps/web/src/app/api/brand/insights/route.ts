// GET /api/brand/insights?days=30 — numbers for posts published in the window
import type { NextRequest } from "next/server";

import { getBrandInsights } from "~/server/brand/insights";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const raw = Number(request.nextUrl.searchParams.get("days") ?? 30);
        const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
        return json(await getBrandInsights(auth.ctx.companyId, days));
    } catch (err) {
        return handleBrandError("GET insights", err, request);
    }
}
