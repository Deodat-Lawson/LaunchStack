import { z } from "zod";

import { startAcceleratorApplication } from "@launchstack/pipelines/accelerators/db";

import { acceleratorRequest, parseBody } from "../_http";

const StartSchema = z
    .object({ programId: z.string().min(1).max(64), cycleId: z.string().min(1).max(64) })
    .strict();

export async function POST(request: Request) {
    return acceleratorRequest(request, "documents.edit", async member => {
        const input = await parseBody(request, StartSchema);
        return {
            application: await startAcceleratorApplication(
                member.companyId,
                member.authUserId,
                input.programId,
                input.cycleId
            ),
        };
    });
}
