// GET /api/prospects/companies?segmentId=&view=&q=&sort=
import type { NextRequest } from "next/server";

import type { CompaniesSort, CompaniesView } from "~/app/employer/tools/growth/prospects/api";
import { listCompanies } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext } from "../_http";

const VIEWS = new Set(["all", "new", "highfit", "uncontacted", "excluded"]);
const SORTS = new Set(["fit", "activity", "name"]);

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const q = request.nextUrl.searchParams;
        const segmentId = q.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        const view = q.get("view") ?? "all";
        const sort = q.get("sort") ?? "fit";
        if (!VIEWS.has(view)) return error("Invalid view", 400);
        if (!SORTS.has(sort)) return error("Invalid sort", 400);
        return json(
            await listCompanies(auth.ctx, segmentId, {
                view: view as CompaniesView,
                sort: sort as CompaniesSort,
                q: q.get("q") ?? "",
            })
        );
    } catch (err) {
        return handleProspectsError("GET companies", err);
    }
}
