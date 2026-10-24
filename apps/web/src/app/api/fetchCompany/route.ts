/**
 * The workspace's embedding configuration, for Settings › Bring your own keys.
 *
 * Gated on `settings.manage`, like the section that reads it and the
 * `updateCompany` route that writes it: the answer carries the embedding
 * provider, the tail of each stored key, the self-hosted endpoint, and the
 * model the workspace's index embeds with (a key of the workspace's own has to
 * be able to run it). The legacy employer and employee passkeys are left out
 * altogether: no screen reads them, and they are shared secrets.
 */

import { NextResponse } from "next/server";
import { db } from "../../../server/db/index";
import { company } from "@launchstack/store/schema";
import { eq } from "drizzle-orm";

import { getRedactedCredentials, resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;

        const [companyRecord] = await db
            .select({
                id: company.id,
                name: company.name,
                description: company.description,
                industry: company.industry,
                embeddingIndexKey: company.embeddingIndexKey,
                activeEmbeddingIndexKey: company.activeEmbeddingIndexKey,
                numberOfEmployees: company.numberOfEmployees,
                useUploadThing: company.useUploadThing,
                createdAt: company.createdAt,
                updatedAt: company.updatedAt,
            })
            .from(company)
            .where(eq(company.id, Number(companyId)));

        if (!companyRecord) {
            return NextResponse.json({ error: "Company not found." }, { status: 404 });
        }

        // Embedding provider credentials come from the encrypted table; the
        // API route only ever surfaces a redacted summary (hasKey + last4).
        // The endpoint URL is not a secret and comes back whole.
        const creds = await getRedactedCredentials(Number(companyId));

        // The index this workspace embeds with: its own key if it has one,
        // else the deployment's EMBEDDING_INDEX, as ingest resolves it. Null
        // when that key isn't registered here; the form then says nothing.
        const { activeEmbeddingIndexKey, ...record } = companyRecord;
        let embeddingModel: {
            indexKey: string;
            provider: string;
            model: string;
            dimension: number;
        } | null = null;
        try {
            const index = resolveEmbeddingIndex(undefined, {
                embeddingIndexKey: activeEmbeddingIndexKey ?? record.embeddingIndexKey,
            });
            embeddingModel = {
                indexKey: index.indexKey,
                provider: index.provider,
                model: index.model,
                dimension: index.dimension,
            };
        } catch {
            embeddingModel = null;
        }

        return NextResponse.json(
            {
                ...record,
                embeddingModel,
                embeddingOpenAIApiKey: creds.openAI,
                embeddingOpenAIBaseUrl: creds.openAIBaseUrl,
                embeddingHuggingFaceApiKey: creds.huggingFace,
                embeddingOllamaBaseUrl: creds.ollamaBaseUrl,
                embeddingOllamaModel: creds.ollamaModel,
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error("Error fetching company:", error);
        return NextResponse.json({ error: "Unable to fetch company" }, { status: 500 });
    }
}
