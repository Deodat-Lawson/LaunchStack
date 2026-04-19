import { NextResponse } from "next/server";
import { db } from "../../../server/db/index";
import { company, users } from "../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { getRedactedCredentials } from "~/lib/ai/company-credentials";


export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({
                success: false,
                message: "Unauthorized"
            }, { status: 401 });
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "Invalid user." },
                { status: 400 }
            );
        }

        const companyId = userInfo.companyId;

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
            return NextResponse.json(
                { error: "Company not found." },
                { status: 404 }
            );
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
            { status: 200 },
        );
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json(
            { error: "Unable to fetch documents" },
            { status: 500 }
        );
    }
}
