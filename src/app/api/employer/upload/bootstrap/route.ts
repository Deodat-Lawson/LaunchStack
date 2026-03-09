import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { category, company, users } from "~/server/db/schema";

type BootstrapCategory = {
  id: string;
  name: string;
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
  };
  storageProvider: "cloud" | "local";
  s3Endpoint: string;
};

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const [userInfo] = await db
      .select({
        role: users.role,
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json({ error: "Invalid user." }, { status: 400 });
    }

    if (userInfo.role !== "employer" && userInfo.role !== "owner") {
      return NextResponse.json(
        { error: "Employer access required." },
        { status: 403 }
      );
    }

    const [categoriesRaw, companyRaw] = await Promise.all([
      db
        .select({
          id: category.id,
          name: category.name,
        })
        .from(category)
        .where(eq(category.companyId, userInfo.companyId)),
      db
        .select({
          id: company.id,
          name: company.name,
          useUploadThing: company.useUploadThing,
        })
        .from(company)
        .where(and(eq(company.id, Number(userInfo.companyId))))
        .limit(1),
    ]);

    const response: UploadBootstrapResponse = {
      categories: categoriesRaw.map((item) => ({
        id: String(item.id),
        name: item.name,
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
      },
      storageProvider:
        (process.env.NEXT_PUBLIC_STORAGE_PROVIDER as "cloud" | "local") ??
        "cloud",
      s3Endpoint: process.env.NEXT_PUBLIC_S3_ENDPOINT ?? "",
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
