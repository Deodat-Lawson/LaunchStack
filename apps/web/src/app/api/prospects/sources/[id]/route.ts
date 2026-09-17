// PATCH /api/prospects/sources/[id] — per-segment source settings arrive with the source registry
import { error } from "../../_http";

export async function PATCH() {
    return error(
        "Source settings arrive with the source registry; keys in the environment decide for now",
        409
    );
}
