import { addTrackerTask, trackerRequestBody } from "~/server/accelerators/tracker";

import { acceleratorRequest } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => ({
        task: await addTrackerTask(member, (await params).id, await trackerRequestBody(request)),
    }));
}
