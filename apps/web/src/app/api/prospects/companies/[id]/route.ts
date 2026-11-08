// GET /api/prospects/companies/[id] — profile, evidence, people, deal
import { after } from "next/server";
import type { NextRequest } from "next/server";

import { getCompany } from "~/server/prospects/service";
import { runProspectResearch } from "~/server/prospects/research";

import { handleProspectsError, json, prospectsContext } from "../../_http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const param = request.nextUrl.searchParams.get("research");
        const research = param === "refresh" ? "refresh" : param === "1";
        const { company, startedResearch } = await getCompany(auth.ctx, id, { research });
        if (startedResearch) {
            after(() =>
                runProspectResearch(auth.ctx, id, request.url, {
                    refresh: research === "refresh",
                }).catch(error => console.error("[prospects] background profile failed:", error))
            );
        }
        return json({ company });
    } catch (err) {
        return handleProspectsError("GET company", err, request);
    }
}
