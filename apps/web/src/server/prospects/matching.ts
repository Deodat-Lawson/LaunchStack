/**
 * What Find companies matches prospects with, per workspace: the workspace's
 * embedding model (companies are matched to the segment by meaning) and, when
 * a chat model is there, the fit check of the shortlist. Either may be
 * missing; the pipeline then matches by shared words and says so.
 */
import { getCompanyEmbeddingConfig, resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import {
    createFitJudge,
    type EmbedTexts,
    type JudgeFit,
} from "@launchstack/pipelines/distribution";

import { getEmbeddings } from "~/lib/models";
import { readRunEnvironment } from "~/server/prospects/run-mode";
import { loadWorkspaceChatModelsScope } from "~/server/workspace-models/scope";

/** The workspace's embedder as the pipeline's port; null when none is configured. */
export async function prospectEmbedder(companyId: bigint): Promise<EmbedTexts | null> {
    try {
        const config = (await getCompanyEmbeddingConfig(companyId)) ?? undefined;
        const { indexKey } = resolveEmbeddingIndex(undefined, config);
        const provider = getEmbeddings(indexKey, config);
        return async texts =>
            provider.embedDocuments
                ? provider.embedDocuments(texts)
                : Promise.all(texts.map(text => provider.embedQuery(text)));
    } catch (error) {
        console.warn("[prospects] no embedding model; matching companies by words:", error);
        return null;
    }
}

/** The fit check, when the workspace or the deployment has a chat model. */
export async function prospectFitJudge(companyId: bigint): Promise<JudgeFit | null> {
    const scope = await loadWorkspaceChatModelsScope(companyId);
    const ownModel = scope.source === "workspace" && Boolean(scope.config);
    return readRunEnvironment(process.env, ownModel).hasModel ? createFitJudge() : null;
}
