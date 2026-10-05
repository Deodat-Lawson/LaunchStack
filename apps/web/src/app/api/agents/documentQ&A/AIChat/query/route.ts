import { NextResponse } from "next/server";
import { SystemMessage, HumanMessage, type AIMessageChunk } from "@langchain/core/messages";
import { db } from "~/server/db/index";
import { and, eq, inArray, like, or } from "drizzle-orm";
import {
    ANNOptimizer,
    createDocumentVectorRetriever,
} from "@launchstack/retrieval/algorithms/vector";
import { documentEnsembleSearch, multiDocEnsembleSearch } from "~/server/rag/ensemble";
import type {
    DocumentSearchOptions,
    MultiDocSearchOptions,
    SearchResult,
} from "@launchstack/retrieval/search-types";
import { resolveEmbeddingIndex, isLegacyEmbeddingIndex } from "@launchstack/llm/embeddings";
import { getCompanyEmbeddingConfig } from "@launchstack/llm/embeddings";
import { validateRequestBody, QuestionSchema } from "~/lib/validation";
import { qaRequestCounter, qaRequestDuration } from "~/server/metrics/registry";
import { document, documentVersions, fileUploads } from "@launchstack/store/schema";
import { ChatHistory } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { forbiddenForPermission, requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { observeScopeSize, recordAuthzDenied } from "~/server/metrics/authz";
import { gateChunksByScope } from "~/server/rag/gate";
import {
    normalizeModelContent,
    performWebSearch,
    getSystemPrompt,
    getWebSearchInstruction,
    describeChatError,
    getEmbeddings,
    buildReferences,
    extractRecommendedPages,
} from "../../services";
import {
    describeChatResolutionFailure,
    resolveConfiguredChatModel,
    resolveConfiguredChatRoute,
    selectChatRoute,
} from "~/lib/models";
import { normalizeTokenUsage } from "@launchstack/llm";
import { validateDeprecatedChatSelection } from "~/server/chat-request-compat";
import type { AttachmentPayload } from "~/lib/validation";
import { createChatStream, throwIfChatAborted, type ChatStreamEvent } from "~/lib/chat-stream";
import { isInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";
import { env } from "~/env";
import { scopeAllowsDocument, type DocumentScope } from "~/lib/authz/scope-types";
import { fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";
import { extractChatPdfText } from "~/server/chat-pdf-text";
import { debitTokens, llmChatTokens } from "~/lib/credits";
import { isMeteringEnabled } from "@launchstack/store/credits";
import type { SYSTEM_PROMPTS } from "../../services/prompts";
import { validateQAResponse } from "~/lib/agents/supervisor";
import { isAgentStyle, mentionedAgentKeys, type AgentStyleId } from "~/lib/agents/definition";
import { readSettingValue } from "~/server/settings/store";
import {
    ChatAgentError,
    agentResponseInfo,
    agentSystemPromptBlock,
    resolveChatAgent,
} from "~/server/collab/chat-agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The `chat.responseStyle` setting for this person, or the product default when unreadable. */
async function defaultAssistantStyle(
    ctx: Parameters<typeof readSettingValue>[0]
): Promise<AgentStyleId> {
    try {
        const value = await readSettingValue<string>(ctx, "chat.responseStyle");
        return isAgentStyle(value) ? value : "concise";
    } catch {
        return "concise";
    }
}

/**
 * Handles in the caller's roster, consulted only when the question contains
 * something shaped like a mention — a turn with no `@` never pays for the
 * lookup, and a roster that cannot be read simply means no mention matched.
 */
async function knownAgentKeys(companyId: bigint, question: string): Promise<string[]> {
    if (!/(^|[^\w@])@[a-z0-9]/i.test(question)) return [];
    try {
        const { listPersonas } = await import("~/server/collab/personas");
        return (await listPersonas(companyId)).map(persona => persona.id);
    } catch (err) {
        console.warn("[AIChat] could not read the agent roster for mentions:", err);
        return [];
    }
}

/** Extract only public reasoning deltas; raw provider payloads never leave the server. */
function rawReasoningDelta(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const choices: unknown = (value as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) return undefined;
    const first: unknown = choices[0];
    if (!first || typeof first !== "object") return undefined;
    const delta: unknown = (first as Record<string, unknown>).delta;
    if (!delta || typeof delta !== "object") return undefined;
    const fields = delta as Record<string, unknown>;
    const reasoning = fields.reasoning_content ?? fields.reasoning;
    return typeof reasoning === "string" ? reasoning : undefined;
}

const ROUTE = "agents/documentQ&A/AIChat/query";

const qaAnnOptimizer = new ANNOptimizer({
    strategy: "hnsw",
    efSearch: 200,
});

/**
 * Cap on total plaintext pulled from text attachments across a single turn.
 * Chosen to leave room for the retrieved RAG context and web results while
 * still accommodating a multi-page text file. Anything past this is truncated
 * with a visible marker so the model knows content was cut.
 */
const ATTACHMENT_TEXT_CAP_BYTES = 40_000;
const ATTACHMENT_PER_FILE_CAP_BYTES = 30_000;

function guessAttachmentKind(name: string, mime: string): "pdf" | "docx" | "plaintext" {
    const lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
    if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/msword" ||
        lower.endsWith(".docx") ||
        lower.endsWith(".doc")
    ) {
        return "docx";
    }
    return "plaintext";
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
    const mammoth = (await import("mammoth")) as unknown as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({
        buffer: Buffer.from(buffer),
    });
    return result.value ?? "";
}

const ATTACHMENT_DOWNLOAD_CAP_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_FILE_DOWNLOAD_CAP_BYTES = 50 * 1024 * 1024;

class AttachmentReadError extends Error {
    constructor(
        message: string,
        readonly status = 400
    ) {
        super(message);
    }
}

interface AttachmentReadContext {
    request: Request;
    companyId: bigint;
    scope: DocumentScope;
}

function isConfiguredStorageUrl(rawUrl: string): boolean {
    const bucket = env.server.S3_BUCKET_NAME;
    if (!bucket) return false;
    const target = new URL(rawUrl);
    return [env.server.NEXT_PUBLIC_S3_ENDPOINT, env.server.S3_PUBLIC_ENDPOINT].some(endpoint => {
        if (!endpoint) return false;
        const configured = new URL(endpoint);
        const prefix = `${configured.pathname.replace(/\/+$/, "")}/${bucket}/documents/`;
        return (
            target.origin === configured.origin &&
            target.pathname.startsWith(prefix) &&
            !target.username &&
            !target.password &&
            !target.search &&
            !target.hash
        );
    });
}

/** Verify stored attachments with the same tenant and document policy as /api/files. */
async function fetchAttachment(
    att: AttachmentPayload,
    context: AttachmentReadContext
): Promise<Response> {
    const { request, companyId, scope } = context;
    throwIfChatAborted(request.signal);
    const requestOrigin = new URL(request.url).origin;
    const internal =
        isInternalFileUrl(att.url, requestOrigin) ||
        isInternalFileUrl(att.url, env.server.APP_PUBLIC_URL);
    const storage = isConfiguredStorageUrl(att.url);
    if (!internal && !storage) {
        try {
            return await fetchPublicUrl(att.url, { signal: request.signal });
        } catch (error) {
            if (error instanceof UrlGuardError) throw new AttachmentReadError(error.message);
            throw error;
        }
    }
    const fileId = internal ? parseInternalFileId(att.url) : null;
    const [file] = await db
        .select()
        .from(fileUploads)
        .where(
            and(
                internal ? eq(fileUploads.id, fileId!) : eq(fileUploads.storageUrl, att.url),
                eq(fileUploads.companyId, companyId)
            )
        )
        .limit(1);
    if (file && file.companyId !== companyId)
        throw new AttachmentReadError("Attachment not found.", 404);
    const backed = await db
        .select({ id: document.id, category: document.category, companyId: document.companyId })
        .from(document)
        .leftJoin(documentVersions, eq(documentVersions.documentId, document.id))
        .where(
            internal
                ? or(
                      like(document.url, `%/api/files/${fileId}`),
                      like(documentVersions.url, `%/api/files/${fileId}`)
                  )
                : or(eq(document.url, att.url), eq(documentVersions.url, att.url))
        );
    // Legacy S3 sources may predate file_uploads, but must have an authorized document.
    const readable = backed.some(
        row => row.companyId === companyId && scopeAllowsDocument(scope, row)
    );
    if ((!file && (internal || !readable)) || (backed.length > 0 && !readable)) {
        throw new AttachmentReadError(
            "Attachment not found or unavailable in your document scope.",
            404
        );
    }
    throwIfChatAborted(request.signal);
    if (internal && file?.storageProvider === "database") {
        if (!file.fileData)
            throw new AttachmentReadError("Attachment content is unavailable.", 404);
        const bytes = Buffer.byteLength(file.fileData, "base64");
        const cap = att.kind === "image" ? 10 * 1024 * 1024 : ATTACHMENT_FILE_DOWNLOAD_CAP_BYTES;
        if (bytes > cap)
            throw new AttachmentReadError(`Attachment "${att.name}" exceeds the size limit.`);
        const content = Buffer.from(file.fileData, "base64");
        return new Response(content, {
            headers: { "content-type": file.mimeType, "content-length": String(bytes) },
        });
    }
    const storageUrl = internal ? file?.storageUrl : att.url;
    if (!storageUrl || !isConfiguredStorageUrl(storageUrl)) {
        throw new AttachmentReadError("Attachment storage is unavailable.", 404);
    }
    // Private configured S3 is allowed only after the ownership check, and cannot redirect.
    return await fetch(storageUrl, { signal: request.signal, redirect: "error" });
}

async function readAttachmentBytes(
    att: AttachmentPayload,
    context: AttachmentReadContext,
    budget: { remaining: number },
    perFileLimit = ATTACHMENT_FILE_DOWNLOAD_CAP_BYTES
): Promise<{ content: Uint8Array<ArrayBuffer>; mimeType: string }> {
    const { signal } = context.request;
    const res = await fetchAttachment(att, context);
    if (!res.ok) {
        await res.body?.cancel();
        throw new AttachmentReadError(
            `Attachment "${att.name}" is unavailable (HTTP ${res.status}). Attach it again or remove it before sending.`,
            res.status === 404 || res.status === 410 ? 404 : 400
        );
    }
    const limit = Math.min(perFileLimit, budget.remaining);
    const announcedSize = Number(res.headers.get("content-length"));
    if (announcedSize > limit) {
        await res.body?.cancel();
        throw new AttachmentReadError(
            `Attachment "${att.name}" exceeds the remaining download size limit.`
        );
    }
    if (!res.body) return { content: new Uint8Array(), mimeType: "" };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            throwIfChatAborted(signal);
            const chunk = await reader.read();
            throwIfChatAborted(signal);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            budget.remaining -= chunk.value.byteLength;
            if (bytes > limit)
                throw new AttachmentReadError(
                    `Attachment "${att.name}" exceeds the remaining download size limit.`
                );
            chunks.push(chunk.value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const content = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return {
        content,
        mimeType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
    };
}

function detectedImageMime(content: Uint8Array): string | null {
    const prefix = Buffer.from(content.subarray(0, 32));
    if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "image/png";
    if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return "image/jpeg";
    if (/^GIF8[79]a/.test(prefix.toString("ascii"))) return "image/gif";
    if (prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP")
        return "image/webp";
    if (prefix.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(prefix.toString("ascii", 8)))
        return "image/avif";
    return null;
}

async function buildImageAttachmentUrls(
    attachments: AttachmentPayload[],
    context: AttachmentReadContext,
    acceptedMimeTypes?: readonly string[]
): Promise<string[]> {
    const budget = { remaining: 80 * 1024 * 1024 };
    const urls: string[] = [];
    for (const att of attachments) {
        const { content, mimeType } = await readAttachmentBytes(
            att,
            context,
            budget,
            10 * 1024 * 1024
        );
        const actualMime = detectedImageMime(content);
        if (!actualMime || (mimeType.startsWith("image/") && mimeType !== actualMime)) {
            throw new AttachmentReadError(
                `Attachment "${att.name}" is not a supported image or its content type does not match its bytes.`
            );
        }
        if (acceptedMimeTypes && !acceptedMimeTypes.includes(actualMime)) {
            throw new AttachmentReadError(
                `The configured vision model does not accept ${actualMime}.`
            );
        }
        urls.push(`data:${actualMime};base64,${Buffer.from(content).toString("base64")}`);
    }
    return urls;
}

async function extractAttachmentText(
    att: AttachmentPayload,
    context: AttachmentReadContext,
    budget: { remaining: number }
): Promise<string> {
    const { content, mimeType } = await readAttachmentBytes(att, context, budget);
    const verifiedKind =
        mimeType === "application/octet-stream" || !mimeType
            ? guessAttachmentKind(att.name, att.mimeType)
            : guessAttachmentKind("", mimeType);
    if (verifiedKind === "pdf")
        return await extractChatPdfText(content.buffer, context.request.signal);
    if (verifiedKind === "docx") return await extractDocxText(content.buffer);
    if (mimeType.startsWith("image/"))
        throw new AttachmentReadError(
            `Attachment "${att.name}" contains an image; attach it as an image to use vision.`
        );
    return new TextDecoder().decode(content);
}

function truncateUtf8(value: string, limit: number): string {
    return new TextDecoder().decode(Buffer.from(value).subarray(0, limit), { stream: true });
}

async function buildAttachmentTextBlock(
    textAttachments: AttachmentPayload[],
    context: AttachmentReadContext
): Promise<string> {
    if (textAttachments.length === 0) return "";
    const { signal } = context.request;

    let remainingBudget = ATTACHMENT_TEXT_CAP_BYTES;
    const downloadBudget = { remaining: ATTACHMENT_DOWNLOAD_CAP_BYTES };
    const blocks: string[] = [];

    for (const att of textAttachments) {
        throwIfChatAborted(signal);
        if (remainingBudget <= 0 || downloadBudget.remaining <= 0) {
            blocks.push(
                `=== User Attachment: ${att.name} ===\n[omitted — prior attachments filled the context budget]`
            );
            continue;
        }

        try {
            const raw = await extractAttachmentText(att, context, downloadBudget);
            if (!raw.trim()) {
                blocks.push(
                    `=== User Attachment: ${att.name} ===\n[no extractable text — if this is a scanned PDF or image-only doc, add it as a Source to run OCR]`
                );
                continue;
            }
            const trimmed = truncateUtf8(
                raw,
                Math.min(ATTACHMENT_PER_FILE_CAP_BYTES, remainingBudget)
            );
            const suffix = trimmed.length < raw.length ? "\n[…attachment truncated]" : "";
            remainingBudget -= Buffer.byteLength(trimmed);
            blocks.push(
                `=== User Attachment: ${att.name} (${att.mimeType}) ===\n${trimmed}${suffix}`
            );
        } catch (err) {
            throwIfChatAborted(signal);
            if (err instanceof AttachmentReadError) throw err;
            console.warn(`[AIChat] Failed to read attachment "${att.name}":`, err);
            throw new AttachmentReadError(
                `Attachment "${att.name}" could not be read. Attach a valid file again or remove it before sending. For a scanned document, add it as a Source to run OCR.`
            );
        }
    }

    return `\n\n${blocks.join("\n\n")}`;
}

/**
 * AIChat Query - Comprehensive search solution
 *
 * This endpoint provides comprehensive document Q&A capabilities:
 * - Answers over one document, or over a set of documents
 * - Advanced retrieval with multiple fallback strategies
 * - Web search integration
 * - Conversation context support
 * - Rich response metadata
 *
 * A search is always over a set of document ids. There is no company-wide
 * search: "everything" is the set of ids in the caller's document scope, so
 * `searchScope: "company"` and `"archive"` are deprecated aliases that
 * resolve to ids and then take the same multi-document path `"selected"`
 * does — one retrieval path, one place the scope is applied.
 */
export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const startTime = Date.now();
        const endTimer = qaRequestDuration.startTimer();
        let retrievalMethod = "not_started";

        let resultRecorded = false;
        const recordResult = (result: "success" | "error" | "empty") => {
            if (resultRecorded) return;
            resultRecorded = true;
            qaRequestCounter.inc({ result, retrieval: retrievalMethod });
            endTimer({ result, retrieval: retrievalMethod });
        };

        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) {
                recordResult("error");
                return ctx.response;
            }
            // Asking is reading. Which documents the answer may draw on is the
            // caller's document scope, resolved once and pushed into every leg.
            if (!ctx.data.can("documents.read")) {
                recordAuthzDenied("documents.read", ROUTE);
                recordResult("error");
                return forbiddenForPermission("documents.read");
            }

            const validation = await validateRequestBody(request, QuestionSchema);
            if (!validation.success) {
                recordResult("error");
                return validation.response;
            }

            const {
                documentId,
                question,
                style: requestedStyle,
                searchScope,
                archiveName,
                selectedDocumentIds,
                enableWebSearch: requestedWebSearch,
                aiPersona,
                aiModel,
                provider,
                conversationHistory,
                embeddingIndexKey,
                thinkingMode: requestedThinking,
                attachments: requestedAttachments,
                agentKey: requestedAgentKey,
                modelRoute: requestedModelRoute,
                reasoningEffort,
                chatMode,
                stream: bodyStreaming,
            } = validation.data;

            const userCompanyId = ctx.data.companyId;
            const numericCompanyId = Number(userCompanyId);
            const scope = await ctx.data.documentScope();
            observeScopeSize(scope);
            const automaticThinking = requestedThinking === "auto";
            const wantsThinking =
                automaticThinking ||
                requestedThinking === true ||
                requestedModelRoute === "reasoning" ||
                Boolean(reasoningEffort);

            // The agent for this turn: an `@handle` in the question wins over
            // the composer's pick, the way a mention summons a subagent in
            // OpenCode. Its tool policy decides which requested tools are allowed.
            let agent = null;
            try {
                const mentioned = mentionedAgentKeys(
                    question,
                    await knownAgentKeys(userCompanyId, question)
                );
                const agentKey = mentioned[0] ?? requestedAgentKey;
                agent = await resolveChatAgent(userCompanyId, agentKey, {
                    webSearch: Boolean(requestedWebSearch),
                    thinking: wantsThinking,
                    hasAttachments: (requestedAttachments ?? []).length > 0,
                    mentioned: mentioned.length > 0,
                });
            } catch (agentError) {
                if (agentError instanceof ChatAgentError) {
                    recordResult("error");
                    return NextResponse.json(
                        { success: false, message: agentError.message },
                        { status: agentError.status }
                    );
                }
                throw agentError;
            }
            const enableWebSearch = agent ? agent.turn.webSearch : Boolean(requestedWebSearch);
            const thinkingMode = agent ? agent.turn.thinking : wantsThinking;
            const wantsStreaming =
                Boolean(bodyStreaming) ||
                Boolean(request.headers.get("accept")?.includes("application/x-ndjson"));
            const attachments = agent?.turn.attachmentsDropped ? [] : requestedAttachments;
            // Style is the agent's when it has one; otherwise the person's own
            // setting for the default assistant (member over workspace over the
            // product default), unless the request named one explicitly.
            const style =
                agent?.turn.style ??
                (requestedStyle !== "concise" ? requestedStyle : null) ??
                (await defaultAssistantStyle(ctx.data));

            // Resolve the chat route before any retrieval, web search, or
            // embedding work: an unavailable route is a 400, and paying for
            // context we are about to discard helps nobody.
            const imageAttachments = (attachments ?? []).filter(a => a.kind === "image");
            const textAttachments = (attachments ?? []).filter(a => a.kind === "text");
            const selected = selectChatRoute({
                vision: imageAttachments.length > 0,
                // Automatic thinking follows the chosen model. It never forces
                // a different route or makes reasoning a required capability.
                reasoning: thinkingMode && !automaticThinking,
                // An agent's preferred route applies when nothing stronger —
                // an image, an explicit reasoning request — has chosen one.
                fast: requestedModelRoute === "fast" || agent?.turn.route === "fast",
            });
            // Explicit selections must keep their actual model identity. Validate
            // capabilities on that route rather than silently substituting another.
            // Legacy requests without a route keep automatic vision/Think routing.
            const route =
                requestedModelRoute ??
                (selected.route === "default" && agent?.turn.route && agent.turn.route !== "vision"
                    ? agent.turn.route
                    : selected.route);
            const requiredCapabilities = Array.from(
                new Set([
                    ...selected.requiredCapabilities,
                    ...(route === "vision" ? ["vision" as const] : []),
                    ...(route === "reasoning" ? ["reasoning" as const] : []),
                ])
            );

            let resolved;
            try {
                const behavior = automaticThinking
                    ? resolveConfiguredChatRoute(route).definition.behavior
                    : undefined;
                const automaticReasoning = thinkingMode && behavior?.reasoning.mode !== "none";
                // Old drafts and model comparisons can carry another route's
                // effort. Auto mode uses only levels this model actually offers.
                const effort = automaticThinking
                    ? automaticReasoning &&
                      behavior?.reasoning.mode === "effort" &&
                      reasoningEffort &&
                      Object.hasOwn(behavior.reasoning.levels, reasoningEffort)
                        ? reasoningEffort
                        : undefined
                    : reasoningEffort;
                resolved = resolveConfiguredChatModel({
                    route,
                    requiredCapabilities,
                    reasoningControl: {
                        enabled: automaticThinking ? automaticReasoning : thinkingMode,
                        effort,
                    },
                    streaming: Boolean(wantsStreaming),
                    temperature: agent?.turn.temperature ?? undefined,
                });
            } catch (modelError) {
                recordResult("error");
                const failure = describeChatResolutionFailure(modelError);
                return NextResponse.json(
                    { success: false, message: failure.message },
                    { status: failure.status }
                );
            }

            const compatibility = validateDeprecatedChatSelection(
                { provider, model: aiModel },
                resolved
            );
            if (!compatibility.ok) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, message: compatibility.message },
                    { status: compatibility.status }
                );
            }
            const { modelId: selectedAiModel, chat } = resolved;
            const streamsModel = Boolean(
                wantsStreaming && resolved.behavior.parameters?.streaming === "supported"
            );

            if (
                imageAttachments.length > 0 &&
                resolved.behavior.image?.maxImages !== undefined &&
                imageAttachments.length > resolved.behavior.image.maxImages
            ) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: `The configured vision model accepts at most ${resolved.behavior.image.maxImages} image(s) per request.`,
                    },
                    { status: 400 }
                );
            }

            // Validate search scope requirements
            if (searchScope === "document" && !documentId) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: "documentId is required for document search",
                    },
                    { status: 400 }
                );
            }

            if (searchScope === "archive" && !archiveName) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: "archiveName is required for archive search",
                    },
                    { status: 400 }
                );
            }

            if (
                searchScope === "selected" &&
                (!selectedDocumentIds || selectedDocumentIds.length === 0)
            ) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: "selectedDocumentIds is required for selected-documents search",
                    },
                    { status: 400 }
                );
            }

            // Every member with `documents.read` may run every search scope;
            // "company" always means the caller's active workspace (the body's
            // companyId is ignored) narrowed to their document scope, not a role.

            // Validate document access. The verified row is kept so history
            // logging below can reuse it instead of re-reading whatever
            // `documentId` the caller sent — on company/archive/selected
            // searches that id is extraneous and was never authorized. A
            // document outside the scope reads as missing: 404, never 403.
            let authorizedDocument: { id: number; title: string } | null = null;
            if (searchScope === "document" && documentId) {
                const [targetDocument] = await db
                    .select({
                        id: document.id,
                        title: document.title,
                    })
                    .from(document)
                    .where(
                        and(eq(document.id, documentId), scopedDocumentWhere(userCompanyId, scope))
                    )
                    .limit(1);

                if (!targetDocument) {
                    recordResult("error");
                    return NextResponse.json(
                        {
                            success: false,
                            message: "Document not found.",
                        },
                        { status: 404 }
                    );
                }

                authorizedDocument = {
                    id: targetDocument.id,
                    title: targetDocument.title,
                };
            }

            let documents: SearchResult[] = [];
            retrievalMethod = "none";
            if (searchScope !== "none") {
                const companyConfig = await getCompanyEmbeddingConfig(numericCompanyId);

                // Every non-document search is a search over ids the caller may
                // read, resolved through the scope. "company" is every readable
                // document; "archive" is the readable documents of one archive;
                // "selected" keeps the supplied ids the caller may read. A stale,
                // cross-company, or out-of-scope id is dropped rather than named —
                // the caller learns nothing about a document they cannot see.
                let searchDocumentIds: number[] | undefined;
                if (searchScope === "company") {
                    const rows = await db
                        .select({ id: document.id })
                        .from(document)
                        .where(scopedDocumentWhere(userCompanyId, scope));
                    searchDocumentIds = rows.map(r => r.id);
                    if (searchDocumentIds.length === 0) {
                        recordResult("empty");
                        return NextResponse.json({
                            success: false,
                            message: "No relevant content found for the given question.",
                        });
                    }
                } else if (searchScope === "archive" && archiveName) {
                    const rows = await db
                        .select({ id: document.id })
                        .from(document)
                        .where(
                            and(
                                eq(document.sourceArchiveName, archiveName),
                                scopedDocumentWhere(userCompanyId, scope)
                            )
                        );
                    searchDocumentIds = rows.map(r => r.id);
                    if (searchDocumentIds.length === 0) {
                        recordResult("empty");
                        return NextResponse.json(
                            {
                                success: false,
                                message: `No documents found in archive "${archiveName}".`,
                            },
                            { status: 404 }
                        );
                    }
                } else if (searchScope === "selected" && selectedDocumentIds?.length) {
                    const uniqueIds = Array.from(new Set(selectedDocumentIds));
                    const rows = await db
                        .select({ id: document.id })
                        .from(document)
                        .where(
                            and(
                                inArray(document.id, uniqueIds),
                                scopedDocumentWhere(userCompanyId, scope)
                            )
                        );
                    searchDocumentIds = rows.map(r => r.id);
                    if (searchDocumentIds.length === 0) {
                        recordResult("error");
                        return NextResponse.json(
                            {
                                success: false,
                                message: "None of the selected documents were found.",
                            },
                            { status: 404 }
                        );
                    }
                }

                // Perform comprehensive search
                const resolvedEmbeddingIndex = resolveEmbeddingIndex(
                    embeddingIndexKey,
                    companyConfig ?? undefined
                );
                const embeddings = getEmbeddings(
                    resolvedEmbeddingIndex.indexKey,
                    companyConfig ?? undefined
                );
                retrievalMethod =
                    searchScope === "company"
                        ? "company_ensemble_rrf"
                        : searchScope === "archive"
                          ? "archive_ensemble_rrf"
                          : searchScope === "selected"
                            ? "selected_ensemble_rrf"
                            : "document_ensemble_rrf";

                try {
                    if (searchDocumentIds?.length) {
                        // One path for every set of ids: from the retriever's
                        // perspective the caller's whole scope, an archive, and a
                        // hand-picked set are identical (`document_id = ANY(...)`).
                        const multiDocOptions: MultiDocSearchOptions = {
                            weights: [0.4, 0.6],
                            topK: 10,
                            documentIds: searchDocumentIds,
                            companyId: numericCompanyId,
                            embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
                        };

                        documents = await multiDocEnsembleSearch(
                            question,
                            multiDocOptions,
                            embeddings
                        );
                    } else if (searchScope === "document" && documentId) {
                        const documentOptions: DocumentSearchOptions = {
                            topK: 5,
                            documentId,
                            companyId: numericCompanyId,
                            embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
                        };

                        documents = await documentEnsembleSearch(
                            question,
                            documentOptions,
                            embeddings
                        );
                    } else {
                        throw new Error("Invalid search parameters");
                    }

                    if (documents.length === 0) {
                        throw new Error("No ensemble results");
                    }
                } catch (ensembleError) {
                    console.warn(
                        `⚠️ [AIChat] Ensemble search failed, falling back:`,
                        ensembleError
                    );

                    if (searchScope !== "document") {
                        // The multi-document path has no narrower fallback.
                        retrievalMethod = `${searchScope}_fallback_failed`;
                        documents = [];
                    } else if (documentId) {
                        if (isLegacyEmbeddingIndex(resolvedEmbeddingIndex)) {
                            retrievalMethod = "ann_hybrid";

                            try {
                                const questionEmbedding = await embeddings.embedQuery(question);
                                const annResults = await qaAnnOptimizer.searchSimilarChunks(
                                    questionEmbedding,
                                    [documentId],
                                    5,
                                    0.8
                                );

                                documents = annResults.map(result => ({
                                    pageContent: result.content,
                                    metadata: {
                                        chunkId: result.id,
                                        page: result.page,
                                        documentId: result.documentId,
                                        distance: 1 - result.confidence,
                                        source: "ann_hybrid",
                                        searchScope: "document" as const,
                                        retrievalMethod: "ann_hybrid" as const,
                                        timestamp: new Date().toISOString(),
                                    },
                                }));
                            } catch (annError) {
                                console.warn(
                                    `⚠️ [AIChat] ANN search failed, using vector search:`,
                                    annError
                                );
                                retrievalMethod = "vector_fallback";
                            }
                        } else {
                            retrievalMethod = "vector_fallback";
                        }

                        if (documents.length === 0) {
                            const retriever = createDocumentVectorRetriever(
                                documentId,
                                embeddings,
                                resolvedEmbeddingIndex,
                                3
                            );
                            const vectorDocs = await retriever.getRelevantDocuments(question);
                            documents = vectorDocs.map(doc => ({
                                retrievalMethod: "vector_fallback",
                                source:
                                    typeof doc.metadata?.source === "string"
                                        ? doc.metadata.source
                                        : undefined,
                                pageNumber:
                                    typeof doc.metadata?.page === "number"
                                        ? doc.metadata.page
                                        : undefined,
                                title:
                                    typeof doc.metadata?.documentTitle === "string"
                                        ? doc.metadata.documentTitle
                                        : undefined,
                                documentId:
                                    typeof doc.metadata?.documentId === "number"
                                        ? doc.metadata.documentId
                                        : undefined,
                                pageContent: doc.pageContent,
                                metadata: {
                                    ...doc.metadata,
                                    searchScope: "document" as const,
                                    retrievalMethod: "vector_fallback" as const,
                                    timestamp: new Date().toISOString(),
                                },
                            })) as unknown as SearchResult[];
                        }
                    } else {
                        retrievalMethod = "invalid_parameters";
                        documents = [];
                    }
                }

                // The last check before anything reaches the prompt: every leg
                // already filtered by the scope in SQL, so this drops nothing —
                // and counts loudly when it does.
                documents = await gateChunksByScope(documents, {
                    companyId: userCompanyId,
                    scope,
                    searchScope: searchScope ?? "document",
                });

                if (documents.length === 0) {
                    recordResult("empty");
                    return NextResponse.json({
                        success: false,
                        message: "No relevant content found for the given question.",
                    });
                }
            }
            throwIfChatAborted(request.signal);

            // Build comprehensive context from retrieved documents
            const combinedContent = documents
                .map((doc, idx) => {
                    const page = doc.metadata?.page ?? "Unknown";
                    const source = doc.metadata?.source ?? retrievalMethod;
                    const distance = doc.metadata?.distance ?? 0;
                    const relevanceScore = Math.round((1 - Number(distance)) * 100);

                    console.log(
                        `📄 [AIChat] Document ${idx + 1}: page ${page}, source: ${source}, relevance: ${relevanceScore}%`
                    );

                    // A company fact is a curated, cited statement, not a passage;
                    // label it so the model treats it as such (ADR-011).
                    const heading =
                        source === "company_fact"
                            ? `=== Company fact #${idx + 1}${
                                  doc.metadata?.documentTitle
                                      ? ` (from ${doc.metadata.documentTitle})`
                                      : ""
                              } ===`
                            : `=== Chunk #${idx + 1}, Page ${page} ===`;
                    return `${heading}\n${doc.pageContent}`;
                })
                .join("\n\n");

            console.log(
                `✅ [AIChat] Built context with pages: ${documents.map(doc => doc.metadata?.page).join(", ")}`
            );

            // Build references for document highlights and page navigation
            const references = buildReferences(question, documents, 5);

            // Perform comprehensive web search if enabled
            const documentContext =
                documents.length > 0
                    ? documents.map(doc => doc.pageContent).join("\n\n")
                    : undefined;

            const enableWebSearchFlag = Boolean(enableWebSearch ?? false);
            const webSearch = await performWebSearch(
                question,
                documentContext,
                enableWebSearchFlag,
                5
            );

            const attachmentContext = { request, companyId: userCompanyId, scope };
            const attachmentTextBlock = await buildAttachmentTextBlock(
                textAttachments,
                attachmentContext
            );
            const imageAttachmentUrls = await buildImageAttachmentUrls(
                imageAttachments,
                attachmentContext,
                resolved.behavior.image?.mimeTypes
            );

            const selectedStyle = (style ?? "concise") satisfies keyof typeof SYSTEM_PROMPTS;

            // Build conversation context
            let conversationContext = "";
            if (conversationHistory) {
                conversationContext = `\n\nPrevious conversation context:\n${conversationHistory}\n\nPlease continue the conversation naturally, referencing previous exchanges when relevant.`;
            }

            // Build comprehensive prompts. The agent's standing instructions go
            // above the style prompt: who is speaking first, then how.
            const stylePrompt = getSystemPrompt(selectedStyle, aiPersona);
            let systemPrompt = agent
                ? `${agentSystemPromptBlock(agent.persona)}\n\n## Answer format\n${stylePrompt}`
                : stylePrompt;
            if (searchScope === "none") {
                systemPrompt +=
                    "\n\nThis turn has no indexed document sources. Answer general questions using your knowledge and the user attachments when present. Do not invent document citations or claim access to workspace sources.";
            }
            if (chatMode === "plan") {
                systemPrompt +=
                    "\n\nPLAN MODE: Produce a concrete, ordered plan for the user request, including dependencies, assumptions, verification steps, and any essential unanswered questions. Treat this as planning: do not claim to have performed actions or completed implementation.";
            }
            const webSearchInstruction = getWebSearchInstruction(
                enableWebSearchFlag,
                webSearch.results,
                webSearch.refinedQuery,
                webSearch.reasoning
            );

            const userPrompt = `User's question: "${question}"${conversationContext}\n\nRelevant document content:\n${combinedContent}${webSearch.content}${attachmentTextBlock}${webSearchInstruction}\n\nProvide a natural, conversational answer ${searchScope === "none" ? "using the user attachments when present and your general knowledge" : "based primarily on the provided content"}. When using information from web sources, cite them using [Source X] format. Address the user directly and maintain continuity with any previous conversation.`;

            // When images are attached, send a multimodal HumanMessage so the
            // vision model sees the text prompt and the image URLs in one turn.
            // Text-only: keep the single-string form for backward compatibility
            // with existing LangChain adapters.
            const humanMessage =
                imageAttachments.length > 0
                    ? new HumanMessage({
                          content: [
                              { type: "text", text: userPrompt },
                              ...imageAttachmentUrls.map(url => ({
                                  type: "image_url" as const,
                                  image_url: { url },
                              })),
                          ],
                      })
                    : new HumanMessage(userPrompt);

            const messages = resolved.prepareMessages([
                new SystemMessage(systemPrompt),
                humanMessage,
            ]);
            // Count the actual prepared text, including expanded history,
            // sources and attachments. Image bytes have their own bounded limit.
            const promptCharacters = messages.reduce((total, message) => {
                if (typeof message.content === "string") return total + message.content.length;
                return (
                    total +
                    message.content.reduce((size, block) => {
                        return (
                            size +
                            (block.type === "text" && typeof block.text === "string"
                                ? block.text.length
                                : 0)
                        );
                    }, 0)
                );
            }, 0);
            if (promptCharacters > 120_000) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message:
                            "The expanded chat input exceeds 120000 characters. Shorten your prompt, remove source or attachment context, or start a new conversation.",
                    },
                    { status: 400 }
                );
            }
            const complete = async (
                signal: AbortSignal,
                emit?: (event: ChatStreamEvent<unknown>) => void
            ) => {
                throwIfChatAborted(signal);
                emit?.({ type: "status", status: "generating" });
                let response;
                let streamedText = "";
                if (emit) {
                    const chunks = await chat.stream(messages, { signal });
                    let combined: AIMessageChunk | undefined;
                    for await (const chunk of chunks) {
                        throwIfChatAborted(signal);
                        const wireReasoning = rawReasoningDelta(
                            chunk.additional_kwargs?.__raw_response
                        );
                        // Do not retain opaque provider metadata in the final chunk.
                        delete chunk.additional_kwargs.__raw_response;
                        combined = combined ? combined.concat(chunk) : chunk;
                        const content = chunk.content;
                        const text =
                            typeof content === "string"
                                ? content
                                : content
                                      .map(part => {
                                          if (typeof part === "string") return part;
                                          return part.type === "text" &&
                                              typeof part.text === "string"
                                              ? part.text
                                              : "";
                                      })
                                      .join("");
                        if (text) {
                            streamedText += text;
                            emit({ type: "text", delta: text });
                        }
                        const reasoning =
                            chunk.additional_kwargs?.reasoning_content ??
                            chunk.additional_kwargs?.reasoning ??
                            wireReasoning;
                        if (typeof reasoning === "string" && reasoning)
                            emit({ type: "reasoning", delta: reasoning });
                        if (Array.isArray(content)) {
                            for (const block of content) {
                                if (typeof block !== "object" || !block) continue;
                                if (block.type === "reasoning" || block.type === "thinking") {
                                    const delta: unknown = block.text ?? block.thinking;
                                    if (typeof delta === "string" && delta)
                                        emit({ type: "reasoning", delta });
                                }
                            }
                        }
                    }
                    if (!combined) throw new Error("The model stream ended without a response.");
                    response = combined;
                } else {
                    response = await chat.invoke(messages, { signal });
                }
                throwIfChatAborted(signal);
                emit?.({ type: "status", status: "finalizing" });

                let summarizedAnswer = normalizeModelContent(
                    emit ? streamedText : response.content
                );
                const totalTime = Date.now() - startTime;

                // Log + meter LLM token usage. Normalized at the chat boundary so
                // credits are debited the same way whichever endpoint answered.
                const usage = normalizeTokenUsage(response);
                const promptTokens = usage.inputTokens ?? 0;
                const completionTokens = usage.outputTokens ?? 0;
                console.log(
                    `[AIChat] Token usage: ${promptTokens} prompt + ${completionTokens} completion = ${usage.totalTokens ?? promptTokens + completionTokens} tokens (model=${selectedAiModel}, ${totalTime}ms)`
                );
                // isMeteringEnabled, not isMeteringEnforced: recording chat usage
                // is useful on a self-hosted instance too. This calls debitTokens
                // directly rather than going through creditsDebitSafe (which would
                // change the recorded metadata shape), so it needs its own guard.
                if (isMeteringEnabled() && userCompanyId && promptTokens + completionTokens > 0) {
                    const tokenCost = llmChatTokens(promptTokens, completionTokens);
                    debitTokens({
                        companyId: userCompanyId,
                        amount: tokenCost,
                        service: "llm_chat",
                        description: `Chat query via ${selectedAiModel}`,
                        metadata: { promptTokens, completionTokens, model: selectedAiModel, route },
                    }).catch(err => console.warn("[AIChat] Token debit failed:", err));
                }

                const sourceTexts = documents.map(d => d.pageContent);
                const supervision = validateQAResponse(summarizedAnswer, sourceTexts, aiPersona);
                if (supervision.adjustedOutput) {
                    summarizedAnswer = supervision.adjustedOutput;
                }

                // Log query to ChatHistory for analytics. Only document-scope
                // searches produce a history row, and only against the document
                // authorized above — a company/archive/selected search carrying a
                // stray documentId must not attach the caller's history to it.
                try {
                    throwIfChatAborted(signal);
                    if (searchScope === "document" && authorizedDocument) {
                        await db.insert(ChatHistory).values({
                            UserId: ctx.data.authUserId,
                            documentId: BigInt(authorizedDocument.id),
                            documentTitle: authorizedDocument.title,
                            question: question,
                            response: summarizedAnswer,
                            pages: extractRecommendedPages(documents),
                            queryType: "simple",
                        });
                    }
                } catch (logError) {
                    console.error("Failed to log chat history:", logError);
                    // Don't fail the request if logging fails
                }

                throwIfChatAborted(signal);
                recordResult("success");

                return {
                    success: true,
                    summarizedAnswer,
                    recommendedPages: extractRecommendedPages(documents),
                    references: references.length > 0 ? references : undefined,
                    retrievalMethod,
                    processingTimeMs: totalTime,
                    chunksAnalyzed: documents.length,
                    // A silent provider reports no usage; do not show fake zeroes.
                    ...(usage.inputTokens !== undefined ||
                    usage.outputTokens !== undefined ||
                    usage.totalTokens !== undefined
                        ? {
                              tokenUsage: {
                                  inputTokens: promptTokens,
                                  outputTokens: completionTokens,
                                  totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
                              },
                          }
                        : {}),
                    fusionWeights: [0.4, 0.6],
                    searchScope,
                    aiModel: selectedAiModel,
                    agent: agentResponseInfo(agent),
                    webSources: enableWebSearchFlag ? webSearch.results : undefined,
                    webSearch: enableWebSearchFlag
                        ? {
                              refinedQuery: webSearch.refinedQuery || question,
                              reasoning: webSearch.reasoning,
                              resultsCount: webSearch.results.length,
                          }
                        : undefined,
                    disclaimer: supervision.disclaimer,
                    guardrails: !supervision.approved
                        ? {
                              warnings: supervision.issues,
                          }
                        : undefined,
                };
            };
            if (streamsModel) {
                const streamingResponse = createChatStream(
                    request.signal,
                    (emit, signal) => complete(signal, emit),
                    error => {
                        recordResult("error");
                        const friendly = describeChatError(error, selectedAiModel);
                        return (
                            friendly?.message ??
                            (error instanceof Error
                                ? error.message
                                : "The chat response failed. Please retry.")
                        );
                    }
                );
                return new NextResponse(streamingResponse.body, {
                    headers: streamingResponse.headers,
                });
            }
            try {
                return NextResponse.json(await complete(request.signal));
            } catch (modelError) {
                throwIfChatAborted(request.signal);
                const friendly = describeChatError(modelError, selectedAiModel);
                if (friendly) {
                    recordResult("error");
                    return NextResponse.json(
                        { success: false, message: friendly.message },
                        { status: friendly.status }
                    );
                }
                throw modelError;
            }
        } catch (error) {
            if (request.signal.aborted) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, cancelled: true, message: "Response stopped" },
                    { status: 499 }
                );
            }
            if (error instanceof AttachmentReadError) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, message: error.message },
                    { status: error.status }
                );
            }
            console.error("❌ [AIChat] Error in query processing:", error);
            recordResult("error");
            return NextResponse.json(
                {
                    success: false,
                    error: "An error occurred while processing your question.",
                },
                { status: 500 }
            );
        }
    });
}
