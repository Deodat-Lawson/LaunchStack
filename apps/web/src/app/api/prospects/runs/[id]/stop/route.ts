// POST /api/prospects/runs/[id]/stop — worker runs cannot be stopped yet
import { error } from "../../../_http";

export async function POST() {
    return error("Runs cannot be stopped once queued; they finish within a few minutes", 409);
}
