/**
 * Production ports for the proposal stages in the web process and the worker:
 * the pipeline's defaults plus this app's metering.
 */
import { createDefaultPorts, type ProposalPorts } from "@launchstack/pipelines/proposals";

import { debitTokens } from "~/lib/credits";

export function createProposalPorts(companyId: bigint): ProposalPorts {
    return createDefaultPorts({
        debitCredits: async ({ amount, description, referenceId }) => {
            await debitTokens({
                companyId,
                amount,
                service: "proposal_writing",
                description,
                referenceId,
            });
        },
    });
}
