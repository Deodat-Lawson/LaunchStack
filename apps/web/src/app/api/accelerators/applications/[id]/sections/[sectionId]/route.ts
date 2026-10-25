import { AnswerPatchSchema } from "@launchstack/pipelines/accelerators/types";
import { saveAcceleratorAnswer } from "@launchstack/pipelines/accelerators/db";

import { acceleratorRequest, parseBody } from "../../../../_http";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const { id, sectionId } = await params;
        const input = await parseBody(request, AnswerPatchSchema);
        return { section: await saveAcceleratorAnswer(member.companyId, id, sectionId, input) };
    });
}
