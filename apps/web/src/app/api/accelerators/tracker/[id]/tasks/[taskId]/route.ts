import {
    editTrackerTask,
    removeTrackerTask,
    trackerRequestBody,
} from "~/server/accelerators/tracker";

import { acceleratorRequest } from "../../../../_http";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const { id, taskId } = await params;
        return {
            task: await editTrackerTask(member, id, taskId, await trackerRequestBody(request)),
        };
    });
}

export async function DELETE(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const { id, taskId } = await params;
        await removeTrackerTask(member, id, taskId);
        return { deleted: true };
    });
}
