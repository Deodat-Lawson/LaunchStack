import {
    editOpportunity,
    loadTrackerOpportunity,
    removeOpportunity,
    trackerRequestBody,
} from "~/server/accelerators/tracker";

import { acceleratorRequest } from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.read", async member => ({
        opportunity: await loadTrackerOpportunity(member, (await params).id),
    }));
}

export async function PATCH(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => ({
        opportunity: await editOpportunity(
            member,
            (await params).id,
            await trackerRequestBody(request)
        ),
    }));
}

export async function DELETE(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => {
        await removeOpportunity(member, (await params).id);
        return { deleted: true };
    });
}
