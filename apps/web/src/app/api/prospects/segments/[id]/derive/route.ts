// POST /api/prospects/segments/[id]/derive — not available until the pipeline reframe
import { error } from "../../../_http";

export async function POST() {
    return error("Deriving a segment from your documents arrives with the pipeline reframe", 409);
}
