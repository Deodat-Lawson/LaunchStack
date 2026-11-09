import { loadTracker, saveOpportunity, trackerRequestBody } from "~/server/accelerators/tracker";

import { acceleratorRequest } from "../_http";

export async function GET(request: Request) {
    return acceleratorRequest(request, "documents.read", async member => ({
        opportunities: await loadTracker(member),
    }));
}

export async function POST(request: Request) {
    return acceleratorRequest(request, "documents.edit", async member => ({
        opportunity: await saveOpportunity(member, await trackerRequestBody(request)),
    }));
}
