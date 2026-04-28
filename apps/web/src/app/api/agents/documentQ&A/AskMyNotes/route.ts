/**
 * Ask My Notes — chat scoped exclusively to the requester's notes.
 *
 * Cousin of `AIQuery` but with a much smaller surface: only the notes
 * retriever (no document chunks, no BM25, no web search). Citations resolve
 * back to note ids so the client can deep-link.
 */

import { NextResponse } from "next/server";
import { OpenAIEmbeddings } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { getChatModel } from "~/lib/models";
import { createUserNotesRetriever } from "~/lib/tools/rag/retrievers/notes-retriever";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  resolveEmbeddingConfig,
} from "~/server/notes/embedding-config";
import { normalizeModelContent } from "../services";

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
    try {
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json(
          { success: false, message: "Unauthorized" },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => ({}))) as Body;
      const question = (body.question ?? "").trim();
      if (!question) {
        return NextResponse.json(
          { success: false, message: "Question is required" },
          { status: 400 },
        );
      }
      const topK = Math.min(Math.max(body.topK ?? 8, 1), 25);

      const { apiKey, baseURL } = resolveEmbeddingConfig();
      if (!apiKey) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Notes search isn't configured — add an embedding API key to enable Ask My Notes.",
          },
          { status: 503 },
        );
      }

      const embeddings = new OpenAIEmbeddings({
        openAIApiKey: apiKey,
        modelName: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        ...(baseURL ? { configuration: { baseURL } } : {}),
      });

      const retriever = createUserNotesRetriever(userId, embeddings, topK);
      const docs = await retriever.invoke(question);

      if (docs.length === 0) {
        return NextResponse.json(
          {
            success: true,
            answer:
              "I couldn't find any relevant notes. Try a different phrasing, or capture some notes first.",
            citations: [],
          },
          { status: 200 },
        );
      }

      const numbered = docs
        .map((d, i) => {
          const title = (d.metadata?.title as string | null) ?? "Untitled";
          return `[${i + 1}] ${title}\n${d.pageContent}`;
        })
        .join("\n\n---\n\n");

      const llm = getChatModel("gpt-4o");
      const reply = await llm.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(
          `Notes:\n\n${numbered}\n\n---\n\nQuestion: ${question}`,
        ),
      ]);

      const answer = normalizeModelContent(reply.content);

      const citations = docs.map((d, i) => ({
        index: i + 1,
        noteId: d.metadata?.noteId as number | undefined,
        title: (d.metadata?.title as string | null) ?? null,
        documentId: (d.metadata?.documentId as string | null) ?? null,
      }));

      return NextResponse.json(
        { success: true, answer, citations },
        { status: 200 },
      );
    } catch (err) {
      console.error("[AskMyNotes] failed:", err);
      return NextResponse.json(
        { success: false, message: "Ask My Notes failed" },
        { status: 500 },
      );
    }
  });
}
