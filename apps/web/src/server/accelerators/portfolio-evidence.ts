import {
    PORTFOLIO_TOP_MATCHES,
    profileEmbeddingEvidenceIds,
    profileEmbeddingText,
    sharedTerms,
    type PortfolioEvidenceLookup,
} from "@launchstack/pipelines/accelerators";
import {
    findSimilarPortfolioCompanies,
    isSupportedAccelerator,
} from "@launchstack/pipelines/accelerators/db";
import type { OrgProfile } from "@launchstack/pipelines/proposals";

import { similarCompanyEmbeddings } from "./embeddings";

/**
 * Portfolio evidence for fit scoring (rubric fit-v2): the same nearest-past-company
 * search the Program page shows, with the profile embedded at most once per run.
 */
export function portfolioEvidenceFor(profile: OrgProfile): PortfolioEvidenceLookup {
    const profileText = profileEmbeddingText(profile);
    const companyEvidenceIds = profileEmbeddingEvidenceIds(profile);
    let vector: Promise<number[]> | null = null;
    const embed = async (): Promise<number[]> => {
        const [embedded] = await similarCompanyEmbeddings().embed([profileText]);
        if (!embedded) throw new Error("The embedding endpoint returned no vector for the profile");
        return embedded;
    };
    return async programId => {
        if (!(await isSupportedAccelerator(programId))) return { supported: false };
        if (!profileText) return { supported: true, matches: [], companyEvidenceIds };
        vector ??= embed();
        const nearest = await findSimilarPortfolioCompanies(programId, await vector, {
            limit: PORTFOLIO_TOP_MATCHES,
        });
        return {
            supported: true,
            companyEvidenceIds,
            matches: nearest.map(({ company, similarity }) => ({
                companyId: company.id,
                name: company.name,
                batch: company.batch,
                similarity: Math.max(-1, Math.min(1, Number(similarity))),
                sharedTerms: sharedTerms(company, profileText),
            })),
        };
    };
}
