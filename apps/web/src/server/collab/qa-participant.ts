/**
 * Room members backed by the workspace's own documents.
 *
 * This is the internal half of a room: each member is bound to a *different*
 * set of documents, so asking the room one question gets you an answer per
 * corpus rather than one answer averaged over all of them. That asymmetry is
 * the entire reason a room beats asking a single agent — members who read the
 * same material produce the same answer N times.
 *
 * Built on `executeRAGSearch`, which is already callable and already
 * access-checks documents. The larger Q&A route (`/api/agents/documentQ&A/...`)
 * has a richer pipeline — web search, attachments, ANN fallbacks — but it is
 * ~330 lines inlined in a request handler where every failure path returns a
 * `NextResponse`, so it cannot be called from here without a refactor that
 * risks the product's main feature. That extraction is worth doing; it is not
 * worth doing in the same change as a new subsystem.
 */

import {
  toExcerpt,
  type AgentPersona,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
  type GroundingSource,
} from "@launchstack/core/collab";

import { executeRAGSearch } from "~/lib/tools/rag";
import { createCollabChatFn } from "./chat";

/** Which documents a member can see. Empty means the member has no sources. */
export interface QaMemberBinding {
  /** Document ids this member answers from. */
  documentIds: string[];
  /** Passages per question. Small: a member's answer should be checkable. */
  topK?: number;
}

export const PASSAGES_PER_QUESTION = 5;

export interface WorkspaceQaRuntimeOptions {
  /**
   * Returns the binding for a persona, or null when this runtime does not own
   * it. Null is what lets a room mix document-backed members with model-only
   * ones in a single roster.
   */
  binding: (persona: AgentPersona) => QaMemberBinding | null;
  /**
   * Whose document access is checked.
   *
   * Deliberately the **asking human**, not the room's creator. Grounding on the
   * meeting path uses the creator, which would make a room a laundering device:
   * a member asks a question and gets an answer retrieved under someone else's
   * grants. The room's document set narrows the corpus; the asker authorizes it.
   */
  actorUserId: string;
  maxOutputTokens?: number;
}

export class WorkspaceQaRuntime implements AgentRuntime {
  readonly nodeId = "local";
  private readonly chat = createCollabChatFn({ maxOutputTokens: 900 });

  constructor(private readonly options: WorkspaceQaRuntimeOptions) {}

  serves(persona: AgentPersona): boolean {
    // Only personas this runtime has a binding for. Ordering matters at the
    // call site: the generic local runtime claims every persona without a
    // nodeId, so this must be consulted first or a document-backed member
    // silently becomes a model with no sources.
    return this.options.binding(persona) !== null;
  }

  async takeTurn({ persona, context, transcript }: AgentTurnRequest): Promise<AgentTurnResult> {
    const binding = this.options.binding(persona);
    if (!binding) throw new Error(`No document binding for @${persona.id}`);

    const question = transcript.at(-1)?.text?.trim() ?? context.objective;
    if (question.length === 0) {
      return { text: "", meta: { adapter: "workspace-qa", declined: true, reason: "no_question" } };
    }

    if (binding.documentIds.length === 0) {
      return {
        text: "I have no documents assigned, so nothing I can see bears on this.",
        meta: { adapter: "workspace-qa", declined: true, reason: "no_documents" },
      };
    }

    const started = Date.now();
    const { results } = await executeRAGSearch(
      {
        query: question,
        documentIds: binding.documentIds,
        topK: binding.topK ?? PASSAGES_PER_QUESTION,
      },
      this.options.actorUserId,
    );

    // Retrieving nothing is a real answer — "my sources don't cover this" is
    // exactly what a room needs to hear from a member, and it is much more
    // useful than a fluent guess.
    if (results.length === 0) {
      return {
        text: "Nothing in my sources covers that.",
        meta: {
          adapter: "workspace-qa",
          declined: true,
          reason: "no_matches",
          documentsSearched: binding.documentIds.length,
          latencyMs: Date.now() - started,
        },
      };
    }

    const sources: GroundingSource[] = [];
    const passages: string[] = [];
    for (const result of results) {
      const content = result.content?.trim();
      if (!content) continue;
      const title = result.documentTitle?.trim() ?? "";
      const label = [title || "Workspace document", result.page ? `p.${result.page}` : null]
        .filter(Boolean)
        .join(" · ");
      passages.push(`${label}: ${content}`);
      sources.push({
        label,
        documentId: result.documentId || undefined,
        page: result.page || undefined,
        score: typeof result.relevanceScore === "number" ? result.relevanceScore : undefined,
        excerpt: toExcerpt(content),
      });
    }

    const text = await this.chat({
      messages: [
        { role: "system", content: buildQaMemberPrompt(persona, context.title, passages) },
        { role: "user", content: question },
      ],
      route: persona.route,
      temperature: persona.temperature,
    });

    return {
      text: text.trim(),
      meta: {
        adapter: "workspace-qa",
        grounding: sources,
        documentsSearched: binding.documentIds.length,
        passagesUsed: passages.length,
        latencyMs: Date.now() - started,
      },
    };
  }
}

/**
 * The member's standing instructions.
 *
 * Written rather than reusing `buildSystemPrompt` because a room member is not
 * holding a floor: it answers once, from a corpus the other members cannot see,
 * and the single most valuable thing it can say is "my sources don't cover
 * this". A prompt that rewards fluency over that turns a room of specialists
 * back into a room of generalists.
 */
export function buildQaMemberPrompt(
  persona: AgentPersona,
  roomName: string,
  passages: string[],
): string {
  return [
    `You are ${persona.displayName}, the ${persona.role}, answering a question in "${roomName}".`,
    "",
    persona.systemPrompt.trim(),
    "",
    "## Your sources",
    "These passages are the only material you can see. Other members of this room are answering the same question from different sources.",
    ...passages.map((p, i) => `[${i + 1}] ${p}`),
    "",
    "## How to answer",
    "- Answer only from the passages above. Quote the figure or clause you are relying on.",
    "- Be short and specific. No preamble, no restating the question.",
    "- If the passages only partly cover the question, answer the part they cover and say plainly which part they do not.",
    "- If they do not bear on the question at all, say exactly that. Being the member with nothing to add is a useful answer; a plausible guess is not.",
    "- Never infer what another member would say. You cannot see their sources.",
  ].join("\n");
}
