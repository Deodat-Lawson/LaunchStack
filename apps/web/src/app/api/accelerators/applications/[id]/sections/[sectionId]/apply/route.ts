import { ApplyEditSchema } from "@launchstack/pipelines/accelerators/types";
import { applyAcceleratorEdit } from "@launchstack/pipelines/accelerators/db";

import { acceleratorRequest, parseBody } from "../../../../../_http";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const { id, sectionId } = await params;
        const edit = await parseBody(request, ApplyEditSchema);
        return { section: await applyAcceleratorEdit(member.companyId, id, sectionId, edit) };
    });
}
