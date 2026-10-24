// POST /api/prospects/segments/[id]/derive — not available until the pipeline reframe
import { error, prospectsT } from "../../../_http";

export async function POST(request: Request) {
    return error(prospectsT(request)("deriveLater"), 409);
}
