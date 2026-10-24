/**
 * Ask My Notes — chat scoped exclusively to the requester's notes.
 *
 * Cousin of `AIChat/query` but with a much smaller surface: only the notes
 * retriever (no document chunks, no BM25, no web search). Citations resolve
 * back to note ids so the client can deep-link.
 */

import { NextResponse } from "next/server";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { resolveConfiguredChatModel } from "~/lib/models";
import { createUserNotesRetriever } from "~/server/notes/notes-retriever";
import { createNotesEmbeddingsProvider } from "~/server/notes/embedding-config";
import { normalizeModelContent } from "../services";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { localeOfRequest, replyLanguageInstruction } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
    question?: string;
    topK?: number;
}

const SYSTEM_PROMPT = `You are answering a user's question using ONLY the notes
they have written themselves. The notes are listed below as numbered entries.

Rules:
- Cite every claim with the note number in square brackets, e.g. [3].
- If the notes don't contain enough information, say so plainly.
- Quote sparingly. Prefer synthesis over copy/paste.
- Never invent note ids or facts not present in the supplied notes.
`;

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const locale = localeOfRequest(request);
        const t = translatorFor(locale, "chat.server.askMyNotes");
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;

            return await withWorkspaceChatModels(ctx.data.companyId, async () => {
                const body = (await request.json().catch(() => ({}))) as Body;
                const question = (body.question ?? "").trim();
                if (!question) {
                    return NextResponse.json(
                        {
                            success: false,
                            message: translatorFor(locale, "errors.validation")("questionRequired"),
                        },
                        { status: 400 }
                    );
                }
                const topK = Math.min(Math.max(body.topK ?? 8, 1), 25);

                const embeddings = createNotesEmbeddingsProvider();
                if (!embeddings) {
                    return NextResponse.json(
                        {
                            success: false,
                            message: t("notConfigured"),
                        },
                        { status: 503 }
                    );
                }

                const retriever = createUserNotesRetriever(
                    ctx.data.authUserId,
                    String(ctx.data.companyId),
                    embeddings,
                    topK
                );
                const docs = await retriever.invoke(question);

                if (docs.length === 0) {
                    return NextResponse.json(
                        {
                            success: true,
                            answer: t("noNotes"),
                            citations: [],
                        },
                        { status: 200 }
                    );
                }

                const numbered = docs
                    .map((d, i) => {
                        const title = (d.metadata?.title as string | null) ?? "Untitled";
                        return `[${i + 1}] ${title}\n${d.pageContent}`;
                    })
                    .join("\n\n---\n\n");

                const resolved = resolveConfiguredChatModel();
                const reply = await resolved.chat.invoke(
                    resolved.prepareMessages([
                        new SystemMessage(
                            [SYSTEM_PROMPT, replyLanguageInstruction(locale)]
                                .filter(Boolean)
                                .join("\n\n")
                        ),
                        new HumanMessage(`Notes:\n\n${numbered}\n\n---\n\nQuestion: ${question}`),
                    ])
                );

                const answer = normalizeModelContent(reply.content);

                const citations = docs.map((d, i) => ({
                    index: i + 1,
                    noteId: d.metadata?.noteId as number | undefined,
                    title: (d.metadata?.title as string | null) ?? null,
                    documentId: (d.metadata?.documentId as string | null) ?? null,
                }));

                return NextResponse.json({ success: true, answer, citations }, { status: 200 });
            });
        } catch (err) {
            console.error("[AskMyNotes] failed:", err);
            return NextResponse.json({ success: false, message: t("failed") }, { status: 500 });
        }
    });
}
