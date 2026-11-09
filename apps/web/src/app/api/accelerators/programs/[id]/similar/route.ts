import { loadSimilarCompanies } from "~/server/accelerators/similar";

import { acceleratorRequest } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

/** Past accepted companies similar to this company's Core profile. Never starts paid matching. */
export async function GET(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.read", async member => ({
        similar: await loadSimilarCompanies(member, (await params).id),
    }));
}
