/**
 * CompanyProjectionPort — the company-state projection (ADR-005 §5).
 *
 * Runs as the `evidence.version.indexed` outbox handler: the indexed source
 * is read for the company profile (sorted — is it about the company? — and,
 * when it is, read for cited facts), then the profile is reassembled from
 * every source that counts. Both steps are idempotent: a redelivered event
 * finds the source already read at this version and reassembles to the same
 * profile, which writes no history row.
 */
import type { CompanyProjectionPort } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";
import { countFacts, refreshForDocument } from "@launchstack/pipelines/company-metadata";

import { generateStructured } from "~/lib/llm";

export function createCompanyProjectionPort(logger: LoggerPort): CompanyProjectionPort {
    return {
        async projectCompanyState({ companyId, sourceId, traceId }) {
            const metadata = await refreshForDocument(BigInt(companyId), sourceId, {
                generate: input => generateStructured({ ...input, capability: "smallExtraction" }),
                modelId: "smallExtraction",
            });
            logger.info(
                {
                    traceId,
                    companyId,
                    sourceId,
                    sourcesCounted: metadata.provenance.sources_counted ?? 0,
                    facts: countFacts(metadata),
                },
                "company profile refreshed from indexed evidence"
            );
            return { projected: true };
        },
    };
}
