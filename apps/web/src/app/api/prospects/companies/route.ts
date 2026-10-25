// GET /api/prospects/companies?segmentId=&view=&q=&sort=
import type { NextRequest } from "next/server";

import type { CompaniesSort, CompaniesView } from "~/app/employer/tools/growth/prospects/api";
import { listCompanies } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, prospectsT } from "../_http";

const VIEWS = new Set(["all", "new", "highfit", "uncontacted", "excluded"]);
const SORTS = new Set(["fit", "activity", "name"]);

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const t = prospectsT(request);
        const q = request.nextUrl.searchParams;
        const segmentId = q.get("segmentId");
        if (!segmentId) return error(t("segmentIdRequired"), 400);
        const view = q.get("view") ?? "all";
        const sort = q.get("sort") ?? "fit";
        if (!VIEWS.has(view)) return error(t("invalidView"), 400);
        if (!SORTS.has(sort)) return error(t("invalidSort"), 400);
        return json(
            await listCompanies(auth.ctx, segmentId, {
                view: view as CompaniesView,
                sort: sort as CompaniesSort,
                q: q.get("q") ?? "",
            })
        );
    } catch (err) {
        return handleProspectsError("GET companies", err, request);
    }
}
