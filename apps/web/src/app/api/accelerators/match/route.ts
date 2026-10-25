import { matchPrograms } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest } from "../_http";

export async function POST(request: Request) {
    return acceleratorRequest(request, "documents.edit", member =>
        withWorkspaceChatModels(member.companyId, "proposals", async () => ({
            run: await matchPrograms(member),
        }))
    );
}
