import { loadAcceleratorRun } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest } from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.read", member =>
        withWorkspaceChatModels(member.companyId, "proposals", async () => ({
            run: await loadAcceleratorRun(member, (await params).id),
        }))
    );
}
