// PATCH /api/prospects/sources/[id] — per-segment source settings arrive with the source registry
import { error, prospectsT } from "../../_http";

export async function PATCH(request: Request) {
    return error(prospectsT(request)("sourceSettingsLater"), 409);
}
