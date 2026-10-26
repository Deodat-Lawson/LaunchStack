// POST /api/prospects/runs/[id]/stop — worker runs cannot be stopped yet
import { error, prospectsT } from "../../../_http";

export async function POST(request: Request) {
    return error(prospectsT(request)("runsCannotStop"), 409);
}
