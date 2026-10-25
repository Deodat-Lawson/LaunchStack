import { loadAccelerators } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest } from "./_http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return acceleratorRequest(request, "documents.read", member =>
        withWorkspaceChatModels(member.companyId, "proposals", () => loadAccelerators(member))
    );
}
