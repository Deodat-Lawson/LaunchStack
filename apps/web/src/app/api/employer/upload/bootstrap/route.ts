import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/server/db";
import { category, company } from "@launchstack/store/schema";
import { folderSettings } from "~/server/db/schema";
import { resolveStorageBackend } from "~/lib/storage";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";

type BootstrapCategory = {
    id: string;
    name: string;
    /** True when the folder is restricted to the people granted access. */
    restricted: boolean;
};

type BootstrapCompany = {
    id: number;
    name: string;
    useUploadThing: boolean;
} | null;

type UploadBootstrapResponse = {
    categories: BootstrapCategory[];
    company: BootstrapCompany;
    isUploadThingConfigured: boolean;
    availableProviders: {
        azure: boolean;
        datalab: boolean;
        landingAI: boolean;
        docling: boolean;
    };
    storageProvider: "s3" | "database";
    s3Endpoint?: string;
};

export async function GET() {
    try {
        // Exposes storage configuration and every folder name, so it sits at
        // the settings tier rather than behind `documents.upload`.
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;

        const [categoriesRaw, companyRaw] = await Promise.all([
            db
                .select({
                    id: category.id,
                    name: category.name,
                    restricted: folderSettings.categoryId,
                })
                .from(category)
                .leftJoin(folderSettings, eq(folderSettings.categoryId, category.id))
                .where(eq(category.companyId, companyId)),
            db
                .select({
                    id: company.id,
                    name: company.name,
                    useUploadThing: company.useUploadThing,
                })
                .from(company)
                .where(and(eq(company.id, Number(companyId))))
                .limit(1),
        ]);

        const response: UploadBootstrapResponse = {
            categories: categoriesRaw.map(item => ({
                id: String(item.id),
                name: item.name,
                restricted: item.restricted != null,
            })),
            company: companyRaw[0]
                ? {
                      id: Number(companyRaw[0].id),
                      name: companyRaw[0].name,
                      useUploadThing: companyRaw[0].useUploadThing,
                  }
                : null,
            isUploadThingConfigured: Boolean(process.env.UPLOADTHING_TOKEN),
            availableProviders: {
                azure:
                    Boolean(process.env.AZURE_DOC_INTELLIGENCE_KEY) &&
                    Boolean(process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT),
                datalab: Boolean(process.env.DATALAB_API_KEY),
                landingAI: Boolean(process.env.LANDING_AI_API_KEY),
                // Docling is reached through services/document-converter (ADR-004).
                docling: Boolean(env.server.DOCUMENT_CONVERTER_URL),
            },
            storageProvider: resolveStorageBackend(),
            ...(resolveStorageBackend() === "s3" && process.env.NEXT_PUBLIC_S3_ENDPOINT
                ? {
                      s3Endpoint:
                          (process.env.S3_PUBLIC_ENDPOINT ?? "") ||
                          process.env.NEXT_PUBLIC_S3_ENDPOINT,
                  }
                : {}),
        };

        return NextResponse.json(response);
    } catch (error: unknown) {
        console.error("Error fetching upload bootstrap data:", error);
        return NextResponse.json(
            { error: "Unable to fetch upload bootstrap data" },
            { status: 500 }
        );
    }
}
