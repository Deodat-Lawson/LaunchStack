import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "../../../server/db/index";
import { company, document, users } from "@launchstack/core/db/schema";
import { validateRequestBody, UpdateCompanySchema } from "~/lib/validation";
import {
  getCompanyCredentialsPlaintext,
  upsertCompanyCredentials,
} from "@launchstack/core/embeddings";
import { validateEmbeddingCredentials } from "~/lib/ai/validate-credentials";
import {
  beginReindex,
  getCompanyReindexState,
} from "~/lib/ai/company-reindex-state";
import { inngest } from "~/server/inngest/client";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

async function readCurrentIndexKey(companyId: number): Promise<string | null> {
  const [row] = await db
    .select({ embeddingIndexKey: company.embeddingIndexKey })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  return row?.embeddingIndexKey ?? null;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const validation = await validateRequestBody(request, UpdateCompanySchema);
    if (!validation.success) {
      return validation.response;
    }
    const {
      name,
      description,
      industry,
      embeddingIndexKey,
      embeddingOpenAIApiKey,
      embeddingHuggingFaceApiKey,
      embeddingOllamaBaseUrl,
      embeddingOllamaModel,
      employerPasskey,
      employeePasskey,
      numberOfEmployees,
      useUploadThing,
    } = validation.data;

    const [userRecord] = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        role: users.role,
      })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userRecord) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (!AUTHORIZED_ROLES.has(userRecord.role)) {
      return NextResponse.json(
        {
          success: false,
          message: "Forbidden",
        },
        { status: 403 }
      );
    }

    // Embedding index key change handling. Three outcomes:
    //   1. No change (current === requested) → apply normally.
    //   2. Change, no docs yet → apply normally, just update columns.
    //   3. Change, docs exist → queue a background reindex job. During
    //      REINDEXING queries still hit the old index; new docs write to
    //      the new index; on completion `active` flips to the new one.
    //      The legacy ?force=true query stays honoured as an "accept the
    //      orphaning, I know what I'm doing" escape hatch (no reindex).
    let reindexResponse: {
      scheduled: boolean;
      jobEventId?: string;
      documentCount?: number;
    } | null = null;

    if (embeddingIndexKey !== undefined) {
      const companyIdForCheck = Number(userRecord.companyId);
      const state = await getCompanyReindexState(companyIdForCheck);

      if (state && state.status === "REINDEXING") {
        return NextResponse.json(
          {
            success: false,
            code: "REINDEX_IN_PROGRESS",
            message:
              "A reindex is already running for this company. Wait for it to finish before changing the embedding index again.",
            activeIndexKey: state.activeIndexKey,
            pendingIndexKey: state.pendingIndexKey,
          },
          { status: 409 },
        );
      }

      const currentIndexKey = state?.activeIndexKey ?? null;
      const url = new URL(request.url);
      const force = url.searchParams.get("force") === "true";

      if (currentIndexKey !== embeddingIndexKey) {
        const [{ count: docCount } = { count: 0 }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(document)
          .where(
            and(eq(document.companyId, BigInt(companyIdForCheck))),
          );

        if (docCount > 0 && !force && embeddingIndexKey) {
          // Queue the Inngest reindex job, flip the company into
          // REINDEXING, and return 202 Accepted. Do NOT write the new key
          // into `embeddingIndexKey`/`activeEmbeddingIndexKey` here —
          // only the reindex job flips `active` once the rewrite
          // completes. `beginReindex` sets `pendingEmbeddingIndexKey`.
          const jobEventId = `reindex-${companyIdForCheck}-${Date.now()}`;
          const acquired = await beginReindex({
            companyId: companyIdForCheck,
            pendingIndexKey: embeddingIndexKey,
            jobId: jobEventId,
          });
          if (!acquired) {
            return NextResponse.json(
              {
                success: false,
                code: "REINDEX_LOCK_CONTENDED",
                message:
                  "Could not acquire the reindex lock. Try again in a few seconds.",
              },
              { status: 409 },
            );
          }
          try {
            await inngest.send({
              id: jobEventId,
              name: "company/reindex-embeddings.requested",
              data: {
                companyId: companyIdForCheck,
                pendingIndexKey: embeddingIndexKey,
                triggeredByUserId: userId,
              },
            });
          } catch (sendErr) {
            console.error("Failed to enqueue reindex job:", sendErr);
            return NextResponse.json(
              {
                success: false,
                message:
                  "Could not schedule the reindex job. The settings change was not applied.",
              },
              { status: 500 },
            );
          }

          reindexResponse = {
            scheduled: true,
            jobEventId,
            documentCount: docCount,
          };
          // Don't let this request also try to set embeddingIndexKey
          // on the company row — the reindex job will flip `active`.
          // Remove it from the regular updateData set below.
        }
      }
    }

    const updateData: Partial<{
      name: string;
      description: string | null;
      industry: string | null;
      embeddingIndexKey: string | null;
      employerpasskey: string;
      employeepasskey: string;
      numberOfEmployees: string;
      useUploadThing: boolean;
    }> = {
      name,
      numberOfEmployees,
    };

    if (description !== undefined) {
      updateData.description = description?.trim() ?? null;
    }
    if (industry !== undefined) {
      updateData.industry = industry?.trim() ?? null;
    }
    if (embeddingIndexKey !== undefined && !reindexResponse) {
      // Only write the new index key through when there is no background
      // reindex to manage the swap — e.g. first-time set, no-op change,
      // or explicit ?force=true. When a reindex was queued above, the
      // job is responsible for moving `active` at completion time.
      updateData.embeddingIndexKey = embeddingIndexKey;
      // Keep the new `activeEmbeddingIndexKey` in sync so ingest and
      // query paths pick it up immediately in the no-docs / force case.
      (updateData as Record<string, unknown>).activeEmbeddingIndexKey =
        embeddingIndexKey;
    }

    if (employerPasskey !== undefined) {
      updateData.employerpasskey = employerPasskey;
    }
    if (employeePasskey !== undefined) {
      updateData.employeepasskey = employeePasskey;
    }

    if (useUploadThing !== undefined) {
      updateData.useUploadThing = useUploadThing;
    }

    const companyIdNum = Number(userRecord.companyId);

    // Credentials live in a separate encrypted table. Only write the fields
    // the caller actually included — `undefined` means "leave alone".
    const credentialsInput: {
      openAIApiKey?: string | null;
      huggingFaceApiKey?: string | null;
      ollamaBaseUrl?: string | null;
      ollamaModel?: string | null;
    } = {};
    if (embeddingOpenAIApiKey !== undefined) {
      credentialsInput.openAIApiKey = embeddingOpenAIApiKey;
    }
    if (embeddingHuggingFaceApiKey !== undefined) {
      credentialsInput.huggingFaceApiKey = embeddingHuggingFaceApiKey;
    }
    if (embeddingOllamaBaseUrl !== undefined) {
      credentialsInput.ollamaBaseUrl = embeddingOllamaBaseUrl;
    }
    if (embeddingOllamaModel !== undefined) {
      credentialsInput.ollamaModel = embeddingOllamaModel;
    }

    // Opt-in pre-save validation. When the UI passes ?validate=true, run a
    // 1-token test embed with the proposed credentials before persisting so
    // bad keys fail fast here instead of during document ingestion.
    const requestUrl = new URL(request.url);
    const shouldValidateCredentials =
      requestUrl.searchParams.get("validate") === "true" &&
      Object.keys(credentialsInput).length > 0;

    if (shouldValidateCredentials) {
      const existing = await getCompanyCredentialsPlaintext(companyIdNum);
      const candidateConfig = {
        embeddingIndexKey:
          embeddingIndexKey ?? (await readCurrentIndexKey(companyIdNum)),
        openAIApiKey:
          credentialsInput.openAIApiKey !== undefined
            ? credentialsInput.openAIApiKey
            : existing?.openAIApiKey ?? null,
        huggingFaceApiKey:
          credentialsInput.huggingFaceApiKey !== undefined
            ? credentialsInput.huggingFaceApiKey
            : existing?.huggingFaceApiKey ?? null,
        ollamaBaseUrl:
          credentialsInput.ollamaBaseUrl !== undefined
            ? credentialsInput.ollamaBaseUrl
            : existing?.ollamaBaseUrl ?? null,
        ollamaModel:
          credentialsInput.ollamaModel !== undefined
            ? credentialsInput.ollamaModel
            : existing?.ollamaModel ?? null,
      };
      const result = await validateEmbeddingCredentials(
        candidateConfig.embeddingIndexKey ?? undefined,
        candidateConfig,
      );
      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            code: "CREDENTIAL_VALIDATION_FAILED",
            message: result.error ?? "Embedding credentials failed validation.",
          },
          { status: 400 },
        );
      }
    }

    if (Object.keys(credentialsInput).length > 0) {
      try {
        await upsertCompanyCredentials(companyIdNum, credentialsInput);
      } catch (credErr) {
        console.error("Failed to persist embedding credentials:", credErr);
        return NextResponse.json(
          {
            success: false,
            message:
              credErr instanceof Error
                ? credErr.message
                : "Unable to store embedding credentials.",
          },
          { status: 500 },
        );
      }
    }

    const updateResult = await db
      .update(company)
      .set(updateData)
      .where(eq(company.id, companyIdNum))
      .returning({ id: company.id });

    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to update company record.",
        },
        { status: 404 }
      );
    }

    if (reindexResponse?.scheduled) {
      return NextResponse.json(
        {
          success: true,
          code: "REINDEX_SCHEDULED",
          message: `Reindex scheduled for ${reindexResponse.documentCount ?? 0} document chunk set(s). Existing documents remain searchable under the previous index until the rewrite completes.`,
          jobEventId: reindexResponse.jobEventId,
          documentCount: reindexResponse.documentCount,
        },
        { status: 202 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Company settings updated.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating company settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unable to update company settings.",
      },
      { status: 500 }
    );
  }
}
