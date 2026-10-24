import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../server/db/index";
import { company, document } from "@launchstack/store/schema";
import { validateRequestBody, UpdateCompanySchema } from "~/lib/validation";
import {
    getCompanyCredentialsPlaintext,
    upsertCompanyCredentials,
    type CompanyCredentialsPlaintext,
    type CredentialUpsertInput,
} from "@launchstack/llm/embeddings";
import { validateEmbeddingCredentials } from "~/lib/ai/validate-credentials";
import {
    WorkspaceEndpointUrlError,
    assertEndpointUrlAllowed,
} from "~/server/workspace-models/endpoint-url";
import { beginReindex, getCompanyReindexState } from "@launchstack/llm/embeddings";
import { inngest } from "~/server/inngest/client";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";

async function readCurrentIndexKey(companyId: number): Promise<string | null> {
    const [row] = await db
        .select({ embeddingIndexKey: company.embeddingIndexKey })
        .from(company)
        .where(eq(company.id, companyId))
        .limit(1);
    return row?.embeddingIndexKey ?? null;
}

/**
 * Why the OpenAI-compatible key and its endpoint can't be saved as asked, or
 * null when they can. The key is only ever sent to the address it was saved
 * with (`resolveEffectiveEmbeddingConfig` never borrows the deployment's), so:
 *   - a new key needs an address, from this request or already stored;
 *   - moving a stored key to a different address needs the key re-entered;
 *   - an address can't be removed out from under a stored key.
 */
function openAIPairProblem(
    requestedKey: string | null | undefined,
    requestedUrl: string | null | undefined,
    existing: CompanyCredentialsPlaintext | null
): { code: string; message: string } | null {
    const storedUrl = existing?.openAIBaseUrl ?? null;
    const nextUrl = requestedUrl !== undefined ? requestedUrl : storedUrl;

    if (requestedKey) {
        if (nextUrl) return null;
        return {
            code: "EMBEDDING_ENDPOINT_REQUIRED",
            message:
                "Enter the embeddings endpoint URL this key belongs to, such as https://api.openai.com/v1. A key is only ever sent to the address it was saved with.",
        };
    }

    const keyStaysStored = requestedKey === undefined && Boolean(existing?.openAIApiKey);
    if (!keyStaysStored || requestedUrl === undefined || requestedUrl === storedUrl) return null;

    if (requestedUrl === null) {
        return {
            code: "EMBEDDING_ENDPOINT_REQUIRED",
            message:
                "The saved embeddings key needs its endpoint URL. Keep the address, or enter a new key together with a new address.",
        };
    }
    return {
        code: "EMBEDDING_KEY_REQUIRED",
        message:
            "The embeddings endpoint changed, so enter the API key for the new address. A saved key is only ever sent to the address it was entered for.",
    };
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

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
            embeddingOpenAIBaseUrl,
            embeddingHuggingFaceApiKey,
            embeddingOllamaBaseUrl,
            embeddingOllamaModel,
            employerPasskey,
            employeePasskey,
            numberOfEmployees,
            useUploadThing,
        } = validation.data;

        const companyIdNum = Number(ctx.data.companyId);

        // Credentials live in a separate encrypted table. Only write the fields
        // the caller actually included — `undefined` means "leave alone".
        // Settled before the reindex below is scheduled, so a refusal here
        // leaves nothing half-done.
        let openAIBaseUrl: string | null | undefined = embeddingOpenAIBaseUrl;
        if (embeddingOpenAIBaseUrl) {
            try {
                openAIBaseUrl = await assertEndpointUrlAllowed(embeddingOpenAIBaseUrl);
            } catch (urlErr) {
                if (urlErr instanceof WorkspaceEndpointUrlError) {
                    return NextResponse.json(
                        {
                            success: false,
                            code: "INVALID_EMBEDDING_ENDPOINT",
                            message: urlErr.message,
                        },
                        { status: 400 }
                    );
                }
                throw urlErr;
            }
        }

        const credentialsInput: CredentialUpsertInput = {};
        if (embeddingOpenAIApiKey !== undefined) {
            credentialsInput.openAIApiKey = embeddingOpenAIApiKey;
        }
        if (openAIBaseUrl !== undefined) {
            credentialsInput.openAIBaseUrl = openAIBaseUrl;
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
        const touchesOpenAIPair =
            credentialsInput.openAIApiKey !== undefined ||
            credentialsInput.openAIBaseUrl !== undefined;

        const existing =
            touchesOpenAIPair || shouldValidateCredentials
                ? await getCompanyCredentialsPlaintext(companyIdNum)
                : null;

        if (touchesOpenAIPair) {
            const problem = openAIPairProblem(
                credentialsInput.openAIApiKey,
                credentialsInput.openAIBaseUrl,
                existing
            );
            if (problem) {
                return NextResponse.json({ success: false, ...problem }, { status: 400 });
            }
        }

        if (shouldValidateCredentials) {
            const pick = <K extends keyof CompanyCredentialsPlaintext>(key: K) =>
                credentialsInput[key] !== undefined
                    ? (credentialsInput[key] ?? null)
                    : (existing?.[key] ?? null);
            const candidateConfig = {
                embeddingIndexKey: embeddingIndexKey ?? (await readCurrentIndexKey(companyIdNum)),
                openAIApiKey: pick("openAIApiKey"),
                openAIBaseUrl: pick("openAIBaseUrl"),
                huggingFaceApiKey: pick("huggingFaceApiKey"),
                ollamaBaseUrl: pick("ollamaBaseUrl"),
                ollamaModel: pick("ollamaModel"),
            };
            const result = await validateEmbeddingCredentials(
                candidateConfig.embeddingIndexKey ?? undefined,
                candidateConfig
            );
            if (!result.ok) {
                return NextResponse.json(
                    {
                        success: false,
                        code: "CREDENTIAL_VALIDATION_FAILED",
                        message: result.error ?? "Embedding credentials failed validation.",
                    },
                    { status: 400 }
                );
            }
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
            const state = await getCompanyReindexState(companyIdNum);

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
                    { status: 409 }
                );
            }

            const currentIndexKey = state?.activeIndexKey ?? null;
            const url = new URL(request.url);
            const force = url.searchParams.get("force") === "true";

            if (currentIndexKey !== embeddingIndexKey) {
                const [{ count: docCount } = { count: 0 }] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(document)
                    .where(and(eq(document.companyId, BigInt(companyIdNum))));

                if (docCount > 0 && !force && embeddingIndexKey) {
                    // Queue the Inngest reindex job, flip the company into
                    // REINDEXING, and return 202 Accepted. Do NOT write the new key
                    // into `embeddingIndexKey`/`activeEmbeddingIndexKey` here —
                    // only the reindex job flips `active` once the rewrite
                    // completes. `beginReindex` sets `pendingEmbeddingIndexKey`.
                    const jobEventId = `reindex-${companyIdNum}-${Date.now()}`;
                    const acquired = await beginReindex({
                        companyId: companyIdNum,
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
                            { status: 409 }
                        );
                    }
                    try {
                        await inngest.send({
                            id: jobEventId,
                            name: "company/reindex-embeddings.requested",
                            data: {
                                companyId: companyIdNum,
                                pendingIndexKey: embeddingIndexKey,
                                triggeredByUserId: ctx.data.authUserId,
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
                            { status: 500 }
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
        }> = {};

        if (name !== undefined) {
            updateData.name = name;
        }
        if (numberOfEmployees !== undefined) {
            updateData.numberOfEmployees = numberOfEmployees;
        }
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
            (updateData as Record<string, unknown>).activeEmbeddingIndexKey = embeddingIndexKey;
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
                    { status: 500 }
                );
            }
        }

        // A credentials-only save (Bring your own keys) leaves the row alone.
        const updateResult =
            Object.keys(updateData).length > 0
                ? await db
                      .update(company)
                      .set(updateData)
                      .where(eq(company.id, companyIdNum))
                      .returning({ id: company.id })
                : [{ id: companyIdNum }];

        if (!updateResult || updateResult.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Unable to update company record.",
                },
                { status: 404 }
            );
        }

        // Which settings changed — never their values: passkeys and credential
        // material do not belong in the audit log.
        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "settings.changed",
            targetType: "workspace",
            targetId: ctx.data.companyId,
            detail: {
                keys: [
                    ...Object.keys(updateData),
                    ...Object.keys(credentialsInput),
                    ...(reindexResponse?.scheduled ? ["embeddingIndexKey"] : []),
                ],
            },
        });

        if (reindexResponse?.scheduled) {
            return NextResponse.json(
                {
                    success: true,
                    code: "REINDEX_SCHEDULED",
                    message: `Reindex scheduled for ${reindexResponse.documentCount ?? 0} document chunk set(s). Existing documents remain searchable under the previous index until the rewrite completes.`,
                    jobEventId: reindexResponse.jobEventId,
                    documentCount: reindexResponse.documentCount,
                },
                { status: 202 }
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
