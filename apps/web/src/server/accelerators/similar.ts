import {
    AcceleratorError,
    hashValue,
    profileEmbeddingText,
    sharedTerms,
    type SimilarCompaniesView,
} from "@launchstack/pipelines/accelerators";
import {
    countPortfolio,
    findSimilarPortfolioCompanies,
    getCatalogueProgram,
    isSupportedAccelerator,
    listApplicationResponses,
} from "@launchstack/pipelines/accelerators/db";
import { loadOrgProfile } from "@launchstack/pipelines/proposals/db";

import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { similarCompanyEmbeddings } from "./embeddings";

const SIMILAR_LIMIT = 12;
const PROFILE_CACHE_LIMIT = 50;

/** One embedding call per distinct profile text and model; profiles change rarely. */
const profileVectors = new Map<string, number[]>();

async function embedProfile(text: string): Promise<number[]> {
    const embeddings = similarCompanyEmbeddings();
    const key = hashValue({ model: embeddings.model, text });
    const cached = profileVectors.get(key);
    if (cached) return cached;
    const [vector] = await embeddings.embed([text]);
    if (!vector) throw new Error("The embedding endpoint returned no vector for the profile");
    if (profileVectors.size >= PROFILE_CACHE_LIMIT) {
        const oldest = profileVectors.keys().next().value;
        if (oldest !== undefined) profileVectors.delete(oldest);
    }
    profileVectors.set(key, vector);
    return vector;
}

/**
 * Past accepted companies most similar to the member's Core profile, each with
 * the application it published, when there is one. Applications of companies
 * outside that list are not shown: how dissimilar companies pitched is noise.
 * Reading this never starts paid matching; only the profile embedding is computed.
 */
export async function loadSimilarCompanies(
    member: WorkspaceContext,
    programId: string
): Promise<SimilarCompaniesView> {
    if (!(await getCatalogueProgram(programId))) {
        throw new AcceleratorError("Program not found", 404, "program_not_found");
    }
    if (!(await isSupportedAccelerator(programId))) return { supported: false };

    const [profile, counts] = await Promise.all([
        loadOrgProfile(member.companyId, await member.documentScope()),
        countPortfolio(programId),
    ]);
    const profileText = profile ? profileEmbeddingText(profile) : "";
    if (!profileText) {
        return {
            supported: true,
            profileReady: false,
            totalCompanies: counts.companies,
            companies: [],
        };
    }

    const [nearest, responses] = await Promise.all([
        embedProfile(profileText).then(vector =>
            findSimilarPortfolioCompanies(programId, vector, { limit: SIMILAR_LIMIT })
        ),
        listApplicationResponses(programId),
    ]);
    const applicationOf = new Map(
        responses.flatMap(response =>
            response.companyId ? [[response.companyId, response] as const] : []
        )
    );

    return {
        supported: true,
        profileReady: true,
        totalCompanies: counts.companies,
        companies: nearest.map(({ company }) => ({
            company,
            sharedTerms: sharedTerms(company, profileText),
            application: applicationOf.get(company.id) ?? null,
        })),
    };
}
