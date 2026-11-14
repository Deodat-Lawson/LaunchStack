import { matchPrograms } from "~/server/accelerators/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { acceleratorRequest } from "../_http";

/**
 * Body: `{ programIds: string[], rescore?: boolean }`. A missing or unreadable body
 * fails `matchPrograms`' validation; only `rescore: true` re-scores current results.
 */
async function scoringRequest(
    request: Request
): Promise<{ programIds: unknown; rescore: boolean }> {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return { programIds: undefined, rescore: false };
    return {
        programIds: "programIds" in body ? body.programIds : undefined,
        rescore: "rescore" in body && body.rescore === true,
    };
}

export async function POST(request: Request) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const { programIds, rescore } = await scoringRequest(request);
        return withWorkspaceChatModels(member.companyId, "proposals", async () => ({
            run: await matchPrograms(member, programIds, rescore),
        }));
    });
}
