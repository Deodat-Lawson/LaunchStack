import { NextResponse } from "next/server";
import { db } from "../../../server/db/index";
import { company } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";

import { getRedactedCredentials } from "@launchstack/core/embeddings";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;

        const [companyRecord] = await db
            .select({
                id: company.id,
                name: company.name,
                description: company.description,
                industry: company.industry,
                embeddingIndexKey: company.embeddingIndexKey,
                employerpasskey: company.employerpasskey,
                employeepasskey: company.employeepasskey,
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
        const creds = await getRedactedCredentials(Number(companyId));

        return NextResponse.json(
            {
                ...companyRecord,
                embeddingOpenAIApiKey: creds.openAI,
                embeddingHuggingFaceApiKey: creds.huggingFace,
                embeddingOllamaBaseUrl: creds.ollamaBaseUrl,
                embeddingOllamaModel: creds.ollamaModel,
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json({ error: "Unable to fetch documents" }, { status: 500 });
    }
}
