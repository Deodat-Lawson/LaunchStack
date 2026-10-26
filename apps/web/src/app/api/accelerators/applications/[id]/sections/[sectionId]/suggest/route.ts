import { EditSuggestionRequestSchema } from "@launchstack/pipelines/accelerators/types";

import { suggestAcceleratorEdit } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest, parseBody } from "../../../../../_http";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", member =>
        withWorkspaceChatModels(member.companyId, "proposals", async () => {
            const { id, sectionId } = await params;
            const body = await parseBody(request, EditSuggestionRequestSchema);
            return { run: await suggestAcceleratorEdit(member, id, sectionId, body) };
        })
    );
}
