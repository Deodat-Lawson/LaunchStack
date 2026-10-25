import { z } from "zod";

import { draftAcceleratorField } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest, parseBody } from "../../../../../_http";

type Params = { params: Promise<{ id: string; sectionId: string }> };
const DraftSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();

export async function POST(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.edit", member =>
        withWorkspaceChatModels(member.companyId, "proposals", async () => {
            const { id, sectionId } = await params;
            const { expectedRevision } = await parseBody(request, DraftSchema);
            return { run: await draftAcceleratorField(member, id, sectionId, expectedRevision) };
        })
    );
}
