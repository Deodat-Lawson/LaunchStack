/**
 * Postgres/RAG implementation of the engine's turn-grounding port.
 *
 * This is the wiring that was missing: the product already has ensemble
 * retrieval over the workspace's documents (`~/lib/tools/rag`), and meeting
 * agents were the one place that reasoned about those documents without ever
 * reading them. Every turn now retrieves against the speaking persona's role
 * and the last thing said, and records what it read on the message it
 * produced.
 *
 * Two properties are deliberate:
 *
 * - **Per-persona, not per-meeting.** The analyst and the engineer ask the
 *   corpus different questions. Retrieving once at creation and sharing the
 *   result gives every agent the union of nobody's actual need.
 * - **Never fatal.** A retrieval failure returns no passages. The orchestrator
 *   treats that as an ungrounded turn, which is worse than a grounded one and
 *   very much better than a dead meeting.
 */

import {
  buildGroundingQuery,
  toExcerpt,
  type GroundingSource,
  type TurnGrounding,
  type TurnGroundingProvider,
  type TurnGroundingRequest,
} from "@launchstack/core/collab";

import { executeRAGSearch } from "~/lib/tools/rag";

export interface MeetingGroundingOptions {
  /** Documents the meeting is allowed to read. Empty disables retrieval. */
  documentIds: string[];
  /**
   * Whose document access is checked. The meeting's creator — retrieval must
   * not become a way to read documents the person who started it cannot.
   */
  userId: string;
  /** Passages per turn. Small on purpose: see `PASSAGES_PER_TURN`. */
  topK?: number;
}

/**
 * Four passages, not ten.
 *
 * Every turn already carries the full transcript, and grounding is appended to
 * that. A generous top-k makes each turn more expensive at exactly the point
 * where cost is already growing with the square of the turn count, and buries
 * the relevant passage among near-misses. Four is enough to answer a question
 * and few enough that a wrong retrieval is visible in the transcript rather
 * than absorbed.
 */
export const PASSAGES_PER_TURN = 4;

export class RagTurnGroundingProvider implements TurnGroundingProvider {
  constructor(private readonly options: MeetingGroundingOptions) {}

  async retrieve(request: TurnGroundingRequest): Promise<TurnGrounding> {
    if (this.options.documentIds.length === 0) return { passages: [] };

    const query = buildGroundingQuery(request);
    if (query.trim().length === 0) return { passages: [] };

    const { results } = await executeRAGSearch(
      {
        query,
        documentIds: this.options.documentIds,
        topK: this.options.topK ?? PASSAGES_PER_TURN,
      },
      this.options.userId,
    );

    const passages: string[] = [];
    const sources: GroundingSource[] = [];
    for (const result of results) {
      if (!result.content || result.content.trim().length === 0) continue;
      const title = result.documentTitle?.trim() ?? "";
      const label = [title || "Workspace document", result.page ? `p.${result.page}` : null]
        .filter(Boolean)
        .join(" · ");

      passages.push(`${label}: ${result.content.trim()}`);
      sources.push({
        label,
        documentId: result.documentId || undefined,
        page: result.page || undefined,
        score: typeof result.relevanceScore === "number" ? result.relevanceScore : undefined,
        excerpt: toExcerpt(result.content),
      });
    }

    return { passages, sources };
  }
}

/**
 * Builds a provider for a meeting, or null when the meeting is not grounded.
 *
 * Returning null rather than an empty provider matters downstream: the
 * orchestrator records a `grounding` key on a message only when a provider ran,
 * so "grounded and found nothing" stays distinguishable from "never asked".
 */
export function buildMeetingGrounding(input: {
  groundingEnabled: boolean;
  documentIds: string[] | null;
  createdByUserId: string | null;
}): RagTurnGroundingProvider | null {
  if (!input.groundingEnabled) return null;
  if (!input.createdByUserId) return null;
  const documentIds = input.documentIds ?? [];
  if (documentIds.length === 0) return null;

  return new RagTurnGroundingProvider({
    documentIds,
    userId: input.createdByUserId,
  });
}
