/**
 * Production ports for the proposal stages in the web process and the worker:
 * the pipeline's defaults plus this app's metering.
 */
import { createDefaultPorts, type ProposalPorts } from "@launchstack/pipelines/proposals";

import { debitTokens } from "~/lib/credits";
import { resolveAcceleratorMember } from "~/server/accelerators/access";
import { prepareAcceleratorRun } from "~/server/accelerators/run";

export function createProposalPorts(companyId: bigint, userId?: string): ProposalPorts {
    const ports = createDefaultPorts({
        debitCredits: async ({ amount, description, referenceId }, executor) => {
            await debitTokens(
                {
                    companyId,
                    amount,
                    service: "proposal_writing",
                    description,
                    referenceId,
                },
                executor
            );
        },
    });
    if (userId) {
        ports.assertAcceleratorAccess = async () => {
            await resolveAcceleratorMember(userId, companyId, "documents.edit");
        };
        ports.prepareAcceleratorRun = (ctx, run) => prepareAcceleratorRun(ctx, ports, run);
    }
    return ports;
}
