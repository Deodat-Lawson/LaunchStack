import { NextResponse } from "next/server";
import type { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
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
import {
    forbiddenForPermission,
    requireWorkspaceContext,
    type WorkspaceContext,
} from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { observeScopeSize, recordAuthzDenied } from "~/server/metrics/authz";
import { gateChunksByScope } from "~/server/rag/gate";
import {
    normalizeModelContent,
    getSystemPrompt,
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
import { getChatModelsSource } from "@launchstack/llm";
import { validateDeprecatedChatSelection } from "~/server/chat-request-compat";
import type { AttachmentPayload } from "~/lib/validation";
import {
    createChatStream,
    throwIfChatAborted,
    type ChatStep,
    type ChatStreamEvent,
} from "~/lib/chat-stream";
import { answerWithTools, type ChatTool } from "~/server/chat-tool-loop";
import { loadChatCompanyProfile } from "~/server/chat-company-profile";
import {
    citedPassages,
    createSourceTools,
    loadSourcesOverview,
    noSourceToolsPrompt,
    sourceToolsPrompt,
} from "~/server/chat-source-tools";
import {
    createDocumentTools,
    documentToolsPrompt,
    noDocumentToolsPrompt,
} from "~/server/chat-document-tools";
import { createWebTools, webSearchAvailable, webToolsPrompt } from "~/server/chat-web-tools";
import {
    FULL_READ_TOKEN_BUDGET,
    MAX_CITED_SOURCES,
    attachedFilesPrompt,
    citeSources,
    excerptsBlock,
    filesShown,
    fitsFullRead,
    fullReadBlock,
    labelScopeFiles,
    manifestBlock,
    onePerSource,
    passageResult,
    type Coverage,
    type ScopeFile,
    type SourcePassage,
} from "~/server/chat-sources";
import { loadScopeFiles, readWholeFiles } from "~/server/chat-source-data";
import { addTokenUsage } from "@launchstack/llm";
import { isInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";
import { env } from "~/env";
import { scopeAllowsDocument, type DocumentScope } from "~/lib/authz/scope-types";
import { fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";
import { extractChatPdfText } from "~/server/chat-pdf-text";
import { debitTokens, llmChatTokens } from "~/lib/credits";
import { shouldDebitChatTokens } from "~/lib/credits/chat-source";
import { isMeteringEnabled } from "@launchstack/store/credits";
import type { SYSTEM_PROMPTS } from "../../services/prompts";
import { validateQAResponse } from "~/lib/agents/supervisor";
import { isAgentStyle, mentionedAgentKeys, type AgentStyleId } from "~/lib/agents/definition";
import { DEFAULT_STYLE } from "~/lib/ai/styles";
import { readSettingValue } from "~/server/settings/store";
import {
    locatePassageContext,
    passagePromptSection,
    retrievalQueryFor,
    withoutAnchoredChunks,
    type PassageAnchor,
} from "~/server/chat-passage-context";
import {
    ChatAgentError,
    agentResponseInfo,
    agentSystemPromptBlock,
    resolveChatAgent,
    type ChatAgentResolution,
} from "~/server/collab/chat-agent";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { copy, type Copy } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import { localeOfRequest, replyLanguageInstruction } from "~/i18n/server";
import { englishCopy, translatorFor, wordEnglish, wordOr } from "~/i18n/translate";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The `chat.responseStyle` setting for this person, or the product default when unreadable. */
async function defaultAssistantStyle(
    ctx: Parameters<typeof readSettingValue>[0]
): Promise<AgentStyleId> {
    try {
        const value = await readSettingValue<string>(ctx, "chat.responseStyle");
        return isAgentStyle(value) ? value : DEFAULT_STYLE;
    } catch {
        return DEFAULT_STYLE;
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

const ROUTE = "agents/documentQ&A/AIChat/query";

type QuestionInput = z.output<typeof QuestionSchema>;

/** What `respond` needs from the validated request. */
interface RespondInput
    extends Pick<QuestionInput, "question">,
        Partial<
            Pick<
                QuestionInput,
                | "searchScope"
                | "archiveName"
                | "selectedDocumentIds"
                | "documentId"
                | "embeddingIndexKey"
                | "conversationHistory"
                | "aiPersona"
                | "chatMode"
            >
        > {
    ctx: { data: WorkspaceContext };
    userCompanyId: bigint;
    numericCompanyId: number;
    scope: DocumentScope;
    passages: NonNullable<QuestionInput["passages"]>;
    retrievalQuery: string;
    authorizedDocument: { id: number; title: string } | null;
    agent: ChatAgentResolution | null;
    enableWebSearch: boolean;
    style: keyof typeof SYSTEM_PROMPTS;
    textAttachments: AttachmentPayload[];
    imageAttachments: AttachmentPayload[];
    resolved: ReturnType<typeof resolveConfiguredChatModel>;
    route: string;
    debitChatTokens: boolean;
    locale: Locale;
}

/** A refusal's JSON body and status; a stream sends the body as its result. */
function refusal(message: string, status = 200) {
    return { body: { success: false as const, message }, status };
}

/** Keeps a step's text inside the stream protocol's limit. */
function clip(text: string, limit = 120): string {
    const chars = Array.from(text);
    return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text;
}

type StepWords = ReturnType<typeof translatorFor<"chat.server.steps">>;

/**
 * Up to three distinct names in order, then "and N more" — counting `total`
 * when some of the things counted have no name to show.
 */
function nameList(names: readonly string[], t: StepWords, total = 0): string | undefined {
    const distinct = Array.from(new Set(names.filter(Boolean)));
    if (distinct.length === 0) return undefined;
    const shown = distinct.slice(0, 3).map(name => clip(name, 60));
    const more = Math.max(distinct.length, total) - shown.length;
    return t("names", { names: shown.join(t("nameSeparator")), more });
}

function stepEvent(
    id: string,
    state: ChatStep["state"],
    label: string,
    detail?: string
): ChatStreamEvent<never> {
    return {
        type: "step",
        step: { id, state, label: clip(label), ...(detail ? { detail: clip(detail, 240) } : {}) },
    };
}

/** `describeChatError` writes English; `chat.server.endpoint` has the reader's words. */
function endpointText(message: string, locale: Locale): string {
    return wordEnglish(message, "chat.server.endpoint", locale);
}

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

/** A refused attachment. The sentence is a `Copy` where this route wrote it. */
class AttachmentReadError extends Error {
    readonly copy: Copy | null;

    constructor(
        message: string | Copy,
        readonly status = 400
    ) {
        super(typeof message === "string" ? message : englishCopy(message));
        this.copy = typeof message === "string" ? null : message;
    }
}

interface AttachmentReadContext {
    request: Request;
    /** The answer's own signal: it also ends when the reader cancels the stream. */
    signal: AbortSignal;
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
    const { request, signal, companyId, scope } = context;
    throwIfChatAborted(signal);
    const requestOrigin = new URL(request.url).origin;
    const internal =
        isInternalFileUrl(att.url, requestOrigin) ||
        isInternalFileUrl(att.url, env.server.APP_PUBLIC_URL);
    const storage = isConfiguredStorageUrl(att.url);
    if (!internal && !storage) {
        try {
            return await fetchPublicUrl(att.url, { signal });
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
        throw new AttachmentReadError(copy("chat.server.attachments.notFound"), 404);
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
        throw new AttachmentReadError(copy("chat.server.attachments.outOfScope"), 404);
    }
    throwIfChatAborted(signal);
    if (internal && file?.storageProvider === "database") {
        if (!file.fileData)
            throw new AttachmentReadError(copy("chat.server.attachments.contentUnavailable"), 404);
        const bytes = Buffer.byteLength(file.fileData, "base64");
        const cap = att.kind === "image" ? 10 * 1024 * 1024 : ATTACHMENT_FILE_DOWNLOAD_CAP_BYTES;
        if (bytes > cap)
            throw new AttachmentReadError(
                copy("chat.server.attachments.tooLarge", { name: att.name })
            );
        const content = Buffer.from(file.fileData, "base64");
        return new Response(content, {
            headers: { "content-type": file.mimeType, "content-length": String(bytes) },
        });
    }
    const storageUrl = internal ? file?.storageUrl : att.url;
    if (!storageUrl || !isConfiguredStorageUrl(storageUrl)) {
        throw new AttachmentReadError(copy("chat.server.attachments.storageUnavailable"), 404);
    }
    // Private configured S3 is allowed only after the ownership check, and cannot redirect.
    return await fetch(storageUrl, { signal, redirect: "error" });
}

async function readAttachmentBytes(
    att: AttachmentPayload,
    context: AttachmentReadContext,
    budget: { remaining: number },
    perFileLimit = ATTACHMENT_FILE_DOWNLOAD_CAP_BYTES
): Promise<{ content: Uint8Array<ArrayBuffer>; mimeType: string }> {
    const { signal } = context;
    const res = await fetchAttachment(att, context);
    if (!res.ok) {
        await res.body?.cancel();
        throw new AttachmentReadError(
            copy("chat.server.attachments.unavailable", {
                name: att.name,
                status: String(res.status),
            }),
            res.status === 404 || res.status === 410 ? 404 : 400
        );
    }
    const limit = Math.min(perFileLimit, budget.remaining);
    const announcedSize = Number(res.headers.get("content-length"));
    if (announcedSize > limit) {
        await res.body?.cancel();
        throw new AttachmentReadError(
            copy("chat.server.attachments.downloadLimit", { name: att.name })
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
                    copy("chat.server.attachments.downloadLimit", { name: att.name })
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
                copy("chat.server.attachments.notAnImage", { name: att.name })
            );
        }
        if (acceptedMimeTypes && !acceptedMimeTypes.includes(actualMime)) {
            throw new AttachmentReadError(
                copy("chat.server.attachments.visionMimeRejected", { mime: actualMime })
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
    if (verifiedKind === "pdf") return await extractChatPdfText(content.buffer, context.signal);
    if (verifiedKind === "docx") return await extractDocxText(content.buffer);
    if (mimeType.startsWith("image/"))
        throw new AttachmentReadError(
            copy("chat.server.attachments.imageAsText", { name: att.name })
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
    const { signal } = context;

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
                copy("chat.server.attachments.unreadable", { name: att.name })
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
 * - Web search as a tool the model calls when it needs one
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
        // The reader's language, for every sentence this route answers with.
        const locale: Locale = localeOfRequest(request);
        const t = translatorFor(locale, "chat.server");
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
                return forbiddenForPermission("documents.read", locale);
            }

            const aiUse = { feature: "ask", userId: ctx.data.authUserId } as const;
            const refused = await refuseAtAiAllowance(ctx.data.companyId, aiUse.userId, locale);
            if (refused) return refused;
            // Everything the answer runs (route resolution, web search, the model
            // call, a streamed body) resolves against the workspace's own models
            // when it brought them.
            return await withWorkspaceChatModels(ctx.data.companyId, aiUse, () => answer(ctx));
        } catch (error) {
            if (request.signal.aborted) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, cancelled: true, message: t("query.stopped") },
                    { status: 499 }
                );
            }
            if (error instanceof AttachmentReadError) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, message: wordOr(error.copy, error.message, locale) },
                    { status: error.status }
                );
            }
            console.error("❌ [AIChat] Error in query processing:", error);
            recordResult("error");
            return NextResponse.json(
                {
                    success: false,
                    error: t("query.failed"),
                },
                { status: 500 }
            );
        }

        async function answer(ctx: { data: WorkspaceContext }) {
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
                passages: requestedPassages,
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
            // The passages the reader selected travel beside the question,
            // which holds only what they typed. Retrieval searches on the
            // question; a bare "explain this" searches on the passage too.
            const passages = requestedPassages ?? [];
            const retrievalQuery = retrievalQueryFor(question, passages);
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
                        {
                            success: false,
                            message: wordOr(agentError.copy, agentError.message, locale),
                        },
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
                agent?.turn.style ?? requestedStyle ?? (await defaultAssistantStyle(ctx.data));

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
                const failure = describeChatResolutionFailure(modelError, locale);
                return NextResponse.json(
                    { success: false, message: failure.message },
                    { status: failure.status }
                );
            }

            const compatibility = validateDeprecatedChatSelection(
                { provider, model: aiModel },
                locale
            );
            if (!compatibility.ok) {
                recordResult("error");
                return NextResponse.json(
                    { success: false, message: compatibility.message },
                    { status: compatibility.status }
                );
            }
            const { modelId: selectedAiModel } = resolved;
            // Read where the model was resolved: tokens a workspace's own
            // endpoint serves are on its provider's bill, not its credits.
            const debitChatTokens = shouldDebitChatTokens(getChatModelsSource());
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
                        message: t("query.tooManyImages", {
                            max: String(resolved.behavior.image.maxImages),
                        }),
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
                        message: t("query.documentIdRequired"),
                    },
                    { status: 400 }
                );
            }

            if (searchScope === "archive" && !archiveName) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: t("query.archiveNameRequired"),
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
                        message: t("query.selectedIdsRequired"),
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
                            message: t("documentNotFound"),
                        },
                        { status: 404 }
                    );
                }

                authorizedDocument = {
                    id: targetDocument.id,
                    title: targetDocument.title,
                };
            }

            // A passage names the document it came from, and its surrounding
            // text is read from that document's index — so every passage
            // document passes the same scope check as a searched document,
            // and one the caller cannot read is missing (404), whatever the
            // search scope. Passage text itself is the caller's own input.
            const passageDocumentIds = Array.from(
                new Set(passages.flatMap(passage => passage.documentId ?? []))
            ).filter(id => id !== authorizedDocument?.id);
            if (passageDocumentIds.length > 0) {
                const readable = await db
                    .select({ id: document.id })
                    .from(document)
                    .where(
                        and(
                            inArray(document.id, passageDocumentIds),
                            scopedDocumentWhere(userCompanyId, scope)
                        )
                    );
                const readableIds = new Set(readable.map(row => row.id));
                if (passageDocumentIds.some(id => !readableIds.has(id))) {
                    recordResult("error");
                    return NextResponse.json(
                        {
                            success: false,
                            message: t("query.passageDocumentNotFound"),
                        },
                        { status: 404 }
                    );
                }
            }
            // Everything past validation runs inside the stream when there is
            // one, so the reader sees each step as it happens.
            const input: RespondInput = {
                ctx,
                question,
                searchScope,
                archiveName,
                selectedDocumentIds,
                documentId,
                embeddingIndexKey,
                conversationHistory,
                aiPersona,
                chatMode,
                userCompanyId,
                numericCompanyId,
                scope,
                passages,
                retrievalQuery,
                authorizedDocument,
                agent,
                enableWebSearch,
                style,
                textAttachments,
                imageAttachments,
                resolved,
                route,
                debitChatTokens,
                locale,
            };
            if (streamsModel) {
                const streamingResponse = createChatStream(
                    request.signal,
                    async (emit, signal) => (await respond(input, emit, signal)).body,
                    error => {
                        recordResult("error");
                        if (error instanceof AttachmentReadError)
                            return wordOr(error.copy, error.message, locale);
                        const friendly = describeChatError(error, selectedAiModel);
                        if (friendly) return endpointText(friendly.message, locale);
                        // A stop is the reader's choice, not a failure worth a stack trace.
                        if (
                            request.signal.aborted ||
                            (error as { name?: unknown })?.name === "AbortError"
                        )
                            return t("query.stopped");
                        // The provider's own text can name the vendor or its
                        // billing page; it goes to the log, not the screen. This one
                        // stays English: the chat screen finds it again
                        // (`chatStreamErrorKey`) and shows its own words.
                        console.error("[AIChat] Streamed response failed:", error);
                        return "The chat response failed. Please retry.";
                    }
                );
                return new NextResponse(streamingResponse.body, {
                    headers: streamingResponse.headers,
                });
            }
            const reply = await respond(input);
            return NextResponse.json(reply.body, { status: reply.status });
        }

        /**
         * The answer after validation: passages, retrieval, web search,
         * attachments, then the model. A refusal comes back as a body and a
         * status, which `answer` sends as JSON or as the stream's result.
         */
        async function respond(
            input: RespondInput,
            emit?: (event: ChatStreamEvent<unknown>) => void,
            signal: AbortSignal = request.signal
        ) {
            const {
                ctx,
                question,
                searchScope,
                archiveName,
                selectedDocumentIds,
                documentId,
                embeddingIndexKey,
                conversationHistory,
                aiPersona,
                chatMode,
                userCompanyId,
                numericCompanyId,
                scope,
                passages,
                retrievalQuery,
                authorizedDocument,
                agent,
                enableWebSearch,
                style,
                textAttachments,
                imageAttachments,
                resolved,
                route,
                debitChatTokens,
                locale,
            } = input;
            const { modelId: selectedAiModel, chat } = resolved;
            const t = translatorFor(locale, "chat.server");
            const ts = translatorFor(locale, "chat.server.steps");
            const step = (...args: Parameters<typeof stepEvent>) => emit?.(stepEvent(...args));

            if (conversationHistory) step("history", "done", ts("history"));
            if (passages.length > 0)
                step("passages", "active", ts("readingPassages", { count: passages.length }));
            const passageAnchors: PassageAnchor[][] = [];
            for (const passage of passages) {
                passageAnchors.push(
                    await locatePassageContext(passage, { companyId: userCompanyId })
                );
            }
            if (passages.length > 0) {
                step("passages", "done", ts("readPassages", { count: passages.length }));
                console.info("[AIChat] passages", {
                    count: passages.length,
                    anchored: passageAnchors.filter(found => found.length > 0).length,
                    retrievalQuery: retrievalQuery.slice(0, 160),
                });
            }

            let documents: SearchResult[] = [];
            retrievalMethod = "none";
            // The files attached to the message, listed for the model by id,
            // and read whole when they fit the full-read budget.
            let scopeFiles: ScopeFile[] = [];
            let wholeFiles: Map<number, SourcePassage[]> | null = null;
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
                        return refusal(t("query.noRelevantContent"));
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
                        return refusal(t("query.archiveEmpty", { archive: archiveName }), 404);
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
                        return refusal(t("query.selectedNotFound"), 404);
                    }
                }
                step(
                    "search",
                    "active",
                    searchScope === "company"
                        ? ts("searchingWorkspace")
                        : searchScope === "archive"
                          ? ts("searchingNamed", { name: archiveName ?? "" })
                          : searchScope === "selected"
                            ? ts("searchingSources", { count: searchDocumentIds?.length ?? 0 })
                            : authorizedDocument
                              ? ts("searchingNamed", { name: authorizedDocument.title })
                              : ts("searchingDocument")
                );

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

                const scopeIds =
                    searchDocumentIds ??
                    (searchScope === "document" && authorizedDocument
                        ? [authorizedDocument.id]
                        : []);
                try {
                    scopeFiles = labelScopeFiles(await loadScopeFiles(scopeIds));
                    if (fitsFullRead(scopeFiles)) {
                        const whole = await readWholeFiles(scopeFiles.map(file => file.id));
                        const chars = [...whole.values()]
                            .flat()
                            .reduce((sum, passage) => sum + passage.content.length, 0);
                        // The index's token counts are estimates; the text read
                        // is the check that it really fits.
                        if (
                            chars <= FULL_READ_TOKEN_BUDGET * 5 &&
                            scopeFiles.every(file => (whole.get(file.id)?.length ?? 0) > 0)
                        ) {
                            wholeFiles = whole;
                        }
                    }
                } catch (scopeError) {
                    // Without the file list the turn still answers, as it did
                    // before: from the retrieved passages.
                    console.warn("[AIChat] Could not read the attached files:", scopeError);
                    scopeFiles = [];
                    wholeFiles = null;
                }

                try {
                    if (wholeFiles) {
                        // Small enough to read whole: no ranking, nothing left out.
                        const read = wholeFiles;
                        retrievalMethod = `${searchScope}_full_read`;
                        documents = scopeFiles.flatMap(file =>
                            (read.get(file.id) ?? []).map(passage => passageResult(passage, file))
                        );
                    } else if (searchDocumentIds?.length) {
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
                            retrievalQuery,
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
                            retrievalQuery,
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
                                const questionEmbedding =
                                    await embeddings.embedQuery(retrievalQuery);
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
                            const vectorDocs = await retriever.getRelevantDocuments(retrievalQuery);
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

                if (documents.length > 0) {
                    // Every document-scope result is that document's, unless
                    // it names its own (a company fact).
                    const fallbackTitle =
                        searchScope === "document" ? authorizedDocument?.title : undefined;
                    const sources = documents.map(doc => {
                        const title = doc.metadata?.documentTitle ?? doc.title ?? fallbackTitle;
                        return { key: doc.metadata?.documentId ?? doc.documentId ?? title, title };
                    });
                    const sourceCount = new Set(sources.flatMap(source => source.key ?? [])).size;
                    step(
                        "search",
                        "done",
                        ts("found", {
                            passages: documents.length,
                            sources: Math.max(sourceCount, 1),
                        }),
                        nameList(
                            sources.flatMap(source => source.title ?? []),
                            ts,
                            sourceCount
                        )
                    );
                } else {
                    step("search", "done", passages.length > 0 ? ts("nothingElse") : ts("nothing"));
                }

                // A selected passage is content enough to answer about.
                if (documents.length === 0 && passages.length === 0) {
                    recordResult("empty");
                    return refusal(t("query.noRelevantContent"));
                }
            }
            throwIfChatAborted(signal);

            // The passage section shows each passage's own chunk; a retrieved
            // copy of it is dropped here and the section shows it whole.
            const { remaining: promptDocuments, covered: anchorsRetrieved } = withoutAnchoredChunks(
                documents,
                passageAnchors.flat()
            );
            const passageSection = passagePromptSection(passages, passageAnchors, {
                whole: anchorsRetrieved,
            });

            // What the model is told about the attached files: the list, each
            // passage under its file's id, and how much of the set it saw
            // (chat-sources.ts). Without that it reads a sample as the whole.
            const coverage: Coverage = wholeFiles
                ? { mode: "full" }
                : promptDocuments.length > 0
                  ? {
                        mode: "excerpts",
                        passages: promptDocuments.length,
                        filesShown: filesShown(promptDocuments, scopeFiles),
                    }
                  : { mode: "passage-only" };
            const combinedContent = wholeFiles
                ? fullReadBlock(scopeFiles, wholeFiles)
                : excerptsBlock(promptDocuments, scopeFiles);
            console.log(
                `✅ [AIChat] Context: ${retrievalMethod}, ${scopeFiles.length} attached file(s), ` +
                    (coverage.mode === "excerpts"
                        ? `${coverage.passages} passage(s) from ${coverage.filesShown} file(s), pages ${promptDocuments.map(doc => doc.metadata?.page).join(", ")}`
                        : coverage.mode === "full"
                          ? `${documents.length} section(s) read whole (${combinedContent.length} chars)`
                          : "selected passage only")
            );

            // A workspace's own model has no tool-calling answer to read
            // (Settings asks about images, reasoning and JSON schema); nearly
            // every OpenAI-compatible server takes function tools, and one that
            // refuses them costs a retry without them (chat-tool-loop.ts), not
            // the answer.
            const takesTools =
                (resolved.behavior.nativeStructuredOutput ?? []).includes("tool-calling") ||
                getChatModelsSource() === "workspace";

            // Web search is a tool the model may call, not a step before the
            // answer: it is offered when the turn's agent may use the web, a
            // search provider key is configured and the model takes tools. A
            // question that needs no web pays nothing for it.
            const webTools =
                enableWebSearch && webSearchAvailable() && takesTools
                    ? createWebTools({}, locale)
                    : null;

            // The workspace's sources are tools too, offered whenever the model
            // takes tools, the agent may use retrieval and the person can open
            // at least one source. Without them a message with nothing attached
            // searched nothing, and "what's in my Google Drive" was answered
            // with "I don't have access to your Drive".
            const sourcesAllowed = agent ? agent.turn.sources : true;
            const sourcesOverview =
                (takesTools && sourcesAllowed) || searchScope === "none"
                    ? await loadSourcesOverview(ctx.data).catch((error: unknown) => {
                          // Not knowing what is there must not cost the answer.
                          console.warn("[AIChat] could not read the sources overview:", error);
                          return null;
                      })
                    : null;
            const sourceTools =
                takesTools &&
                sourcesAllowed &&
                sourcesOverview &&
                sourcesOverview.inventory.total > 0
                    ? createSourceTools(ctx.data, {}, locale, { attached: scopeFiles })
                    : null;
            // Writing is a tool as well: asked for a document, the model makes
            // one in the workspace instead of pasting it here and telling the
            // person to copy it into a file. Offered to anyone who may add
            // files, when the model takes tools and the agent may write.
            const writeAllowed = takesTools && (agent ? agent.turn.write : true);
            const mayUpload = ctx.data.can("documents.upload");
            const documentTools =
                writeAllowed && mayUpload
                    ? createDocumentTools(ctx.data, { requestUrl: request.url, locale })
                    : null;
            const tools = [
                ...(sourceTools?.tools ?? []),
                ...(documentTools?.tools ?? []),
                ...(webTools?.tools ?? []),
            ];
            // Nothing attached and no way to look through the sources: say so,
            // rather than leave the reader to guess what the answer drew on.
            if (searchScope === "none" && passages.length === 0 && !sourceTools)
                step("search", "done", ts("noSources"), ts("generalKnowledge"));

            const attachmentCount = textAttachments.length + imageAttachments.length;
            if (attachmentCount > 0)
                step("attachments", "active", ts("readingAttachments", { count: attachmentCount }));
            const attachmentContext = { request, signal, companyId: userCompanyId, scope };
            const attachmentTextBlock = await buildAttachmentTextBlock(
                textAttachments,
                attachmentContext
            );
            const imageAttachmentUrls = await buildImageAttachmentUrls(
                imageAttachments,
                attachmentContext,
                resolved.behavior.image?.mimeTypes
            );
            if (attachmentCount > 0)
                step(
                    "attachments",
                    "done",
                    ts("readAttachments", { count: attachmentCount }),
                    nameList(
                        [...textAttachments, ...imageAttachments].map(att => att.name),
                        ts
                    )
                );

            const selectedStyle = style satisfies keyof typeof SYSTEM_PROMPTS;

            // Build conversation context
            let conversationContext = "";
            if (conversationHistory) {
                conversationContext = `\n\nPrevious conversation context:\n${conversationHistory}\n\nPlease continue the conversation naturally, referencing previous exchanges when relevant.`;
            }

            // Operating rules precede presentation preferences; a named
            // agent supplies the role and more specific output contract.
            const stylePrompt = getSystemPrompt(selectedStyle, aiPersona);
            let systemPrompt = agent
                ? `${stylePrompt}\n\n## Agent instructions\n${agentSystemPromptBlock(agent.persona)}`
                : stylePrompt;
            const companyProfile = sourcesAllowed
                ? await loadChatCompanyProfile(ctx.data, scope)
                : "";
            if (companyProfile) systemPrompt += `\n\n${companyProfile}`;
            if (scopeFiles.length > 0) {
                systemPrompt += `\n\n${attachedFilesPrompt(scopeFiles, coverage, Boolean(sourceTools))}`;
            }
            if (sourceTools && sourcesOverview) {
                systemPrompt += `\n\n${sourceToolsPrompt(sourcesOverview, searchScope !== "none")}`;
            } else if (searchScope === "none") {
                systemPrompt += `\n\n${noSourceToolsPrompt(sourcesOverview)}`;
            }
            if (searchScope === "none") {
                if (passages.length > 0) {
                    systemPrompt +=
                        "\n\nThe user did select passage(s) from their documents: those passages, and any surrounding text shown with them, are in the message and may be quoted.";
                }
            }
            if (chatMode === "plan") {
                systemPrompt +=
                    "\n\nPLAN MODE: Produce a concrete, ordered plan for the user request, including dependencies, assumptions, verification steps, and any essential unanswered questions. Treat this as planning: do not claim to have performed actions or completed implementation.";
            }
            if (documentTools) {
                systemPrompt += `\n\n${documentToolsPrompt()}`;
            } else if (writeAllowed && !mayUpload) {
                systemPrompt += `\n\n${noDocumentToolsPrompt()}`;
            }
            if (webTools) systemPrompt += `\n\n${webToolsPrompt(new Date())}`;
            // Answer in the language the person reads the app in, unless they
            // write in another one (src/i18n/server.ts).
            const replyLanguage = replyLanguageInstruction(locale);
            if (replyLanguage) systemPrompt += `\n\n${replyLanguage}`;

            const passageBlock = passageSection ? `${passageSection}\n\n` : "";
            const documentContent =
                passageSection && !combinedContent
                    ? "(nothing beyond the selected passage)"
                    : combinedContent;
            const contentHeading =
                scopeFiles.length === 0
                    ? "Relevant document content:"
                    : coverage.mode === "full"
                      ? "Full text of every attached file:"
                      : coverage.mode === "excerpts"
                        ? `Relevant passages (${coverage.passages} from ${coverage.filesShown} of ${scopeFiles.length} attached file${scopeFiles.length === 1 ? "" : "s"}):`
                        : "Relevant passages:";
            const manifest = scopeFiles.length > 0 ? `${manifestBlock(scopeFiles)}\n\n` : "";
            const userPrompt = `User's question: "${question}"${conversationContext}\n\n${passageBlock}${manifest}${contentHeading}\n${documentContent}${attachmentTextBlock}\n\nAnswer ${searchScope !== "none" ? "based primarily on the provided content" : sourceTools ? "using what you find in the workspace's sources when the question is about them, the user attachments when present, and your general knowledge" : "using the user attachments when present and your general knowledge"}.${webTools ? " When using information from web sources, cite them using [Source N] format." : ""} Maintain continuity with any previous conversation.`;

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
            // A whole-file read has its own budget (FULL_READ_TOKEN_BUDGET);
            // the limit holds for everything else in the prompt.
            const fullReadCharacters = wholeFiles ? combinedContent.length : 0;
            if (promptCharacters - fullReadCharacters > 120_000) {
                recordResult("error");
                return refusal(t("query.inputTooLong"), 400);
            }
            const complete = async (
                signal: AbortSignal,
                emit?: (event: ChatStreamEvent<unknown>) => void
            ) => {
                throwIfChatAborted(signal);
                emit?.({ type: "status", status: "generating" });
                // The trace: thinking, each tool call as its own step (its id
                // says which kind, so a shared reader can be shown a generic
                // label), thinking again after the tools, then writing.
                let calling = "";
                const tracked: ChatTool[] = tools.map(tool => ({
                    ...tool,
                    describe: args => {
                        calling = tool.name;
                        return tool.describe(args);
                    },
                }));
                const webToolNames = new Set((webTools?.tools ?? []).map(tool => tool.name));
                const documentToolNames = new Set(
                    (documentTools?.tools ?? []).map(tool => tool.name)
                );
                let round = 1;
                let thinking: string | null = null;
                let toolCall: { id: string; label: string } | null = null;
                let toolCount = 0;
                let wrote = false;
                const startThinking = () => {
                    thinking = round === 1 ? "think" : `think-${round}`;
                    step(thinking, "active", ts("thinking"));
                };
                const endThinking = () => {
                    if (thinking) step(thinking, "done", ts("thought"));
                    thinking = null;
                };
                const endToolCall = () => {
                    if (toolCall) step(toolCall.id, "done", toolCall.label);
                    toolCall = null;
                };
                if (emit) startThinking();
                const reply = await answerWithTools({
                    chat,
                    messages,
                    tools: tracked,
                    // Checking every file can take a listing, a fan-out and a
                    // second page of it before the answer.
                    maxToolRounds: sourceTools ? 6 : 3,
                    hasInitialEvidence:
                        documents.length > 0 ||
                        passages.length > 0 ||
                        attachmentTextBlock.length > 0 ||
                        imageAttachmentUrls.length > 0,
                    signal,
                    stream: emit && {
                        onText: delta => {
                            if (!wrote) {
                                endToolCall();
                                endThinking();
                                step("write", "active", ts("writing"));
                                wrote = true;
                            }
                            emit({ type: "text", delta });
                        },
                        onReasoning: delta => emit({ type: "reasoning", delta }),
                    },
                    onStatus: status => {
                        emit?.({ type: "status", status });
                        if (!emit) return;
                        endToolCall();
                        if (status === "generating") {
                            round += 1;
                            startThinking();
                            return;
                        }
                        endThinking();
                        const kind = webToolNames.has(calling)
                            ? "web"
                            : documentToolNames.has(calling)
                              ? "doc"
                              : "source";
                        toolCall = { id: `${kind}-${++toolCount}`, label: status };
                        step(toolCall.id, "active", status);
                    },
                    // Looking (a search, a read) and then writing takes a
                    // round more than looking alone.
                    ...(documentTools ? { maxToolRounds: 4 } : {}),
                });
                if (emit) {
                    endToolCall();
                    if (wrote) step("write", "done", ts("wrote"));
                    else endThinking();
                }
                throwIfChatAborted(signal);
                emit?.({ type: "status", status: "finalizing" });

                let summarizedAnswer = normalizeModelContent(
                    emit ? reply.finalText : reply.finalContent
                );
                // The sources the answer cites by id become its source list;
                // the ids themselves are taken out of the text.
                const rawAnswer = summarizedAnswer;
                const cited = citeSources(
                    rawAnswer,
                    [...documents, ...(sourceTools?.passages ?? [])],
                    scopeFiles
                );
                summarizedAnswer = cited.text;
                const totalTime = Date.now() - startTime;

                // Log + meter LLM token usage, summed over every model call
                // of the turn. Normalized at the chat boundary so credits are
                // debited the same way whichever deployment endpoint answered;
                // a workspace's own endpoint is never debited.
                // The per-source reads `ask_each` made are part of the turn.
                const usage = sourceTools
                    ? addTokenUsage(reply.usage, sourceTools.usage())
                    : reply.usage;
                const promptTokens = usage.inputTokens ?? 0;
                const completionTokens = usage.outputTokens ?? 0;
                console.log(
                    `[AIChat] Token usage: ${promptTokens} prompt + ${completionTokens} completion = ${usage.totalTokens ?? promptTokens + completionTokens} tokens (model=${selectedAiModel}, ${totalTime}ms)`
                );
                if (tools.length > 0) {
                    console.log(
                        `[AIChat] Tools: ${reply.modelCalls} model call(s); ${
                            reply.toolCalls
                                .map(
                                    call => `${call.name}${call.ok ? "" : " (failed)"} ${call.ms}ms`
                                )
                                .join(", ") || "no tool calls"
                        }`
                    );
                }
                // isMeteringEnabled, not isMeteringEnforced: recording chat usage
                // is useful on a self-hosted instance too. This calls debitTokens
                // directly rather than going through creditsDebitSafe (which would
                // change the recorded metadata shape), so it needs its own guard.
                if (
                    isMeteringEnabled() &&
                    debitChatTokens &&
                    userCompanyId &&
                    promptTokens + completionTokens > 0
                ) {
                    const tokenCost = llmChatTokens(promptTokens, completionTokens);
                    debitTokens({
                        companyId: userCompanyId,
                        amount: tokenCost,
                        service: "llm_chat",
                        description: `Chat query (${route} route)`,
                        metadata: { promptTokens, completionTokens, model: selectedAiModel, route },
                    }).catch(err => console.warn("[AIChat] Token debit failed:", err));
                }

                // The passages and their surrounding text are sources too, and
                // so is whatever the source tools showed the model.
                const toolPassages = sourceTools?.passages ?? [];
                const sourceTexts = [
                    ...documents.map(d => d.pageContent),
                    ...(sourceTools?.texts ?? []),
                    ...passages.map(passage => passage.text),
                    ...passageAnchors.flat().map(anchor => anchor.content),
                ];
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

                // Citations: the sources the answer cites, one entry each. An
                // answer that cites none falls back to the attached sources'
                // passages, then what the tools found that it names.
                const references = buildReferences(
                    retrievalQuery,
                    cited.cited ??
                        onePerSource([...documents, ...citedPassages(toolPassages, rawAnswer)]),
                    MAX_CITED_SOURCES
                );

                return {
                    success: true,
                    summarizedAnswer,
                    recommendedPages: extractRecommendedPages(documents),
                    references: references.length > 0 ? references : undefined,
                    retrievalMethod,
                    processingTimeMs: totalTime,
                    chunksAnalyzed: documents.length + toolPassages.length,
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
                    agent: agentResponseInfo(agent),
                    // The pages the model was shown, in the [Source N] order it cites.
                    webSources: webTools?.sources.length ? webTools.sources : undefined,
                    webSearch:
                        webTools && webTools.queries.length > 0
                            ? {
                                  refinedQuery: webTools.queries.join(" · "),
                                  queries: webTools.queries,
                                  resultsCount: webTools.sources.length,
                              }
                            : undefined,
                    // The documents the answer wrote, for the chat to list and open.
                    createdSources: documentTools?.created.length
                        ? documentTools.created
                        : undefined,
                    disclaimer: supervision.disclaimer,
                    guardrails: !supervision.approved
                        ? {
                              warnings: supervision.issues,
                          }
                        : undefined,
                };
            };
            if (emit) return { body: await complete(signal, emit), status: 200 };
            try {
                return { body: await complete(signal), status: 200 };
            } catch (modelError) {
                throwIfChatAborted(signal);
                const friendly = describeChatError(modelError, selectedAiModel);
                if (friendly) {
                    recordResult("error");
                    return refusal(endpointText(friendly.message, locale), friendly.status);
                }
                throw modelError;
            }
        }
    });
}
