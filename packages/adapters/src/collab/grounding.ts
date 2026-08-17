/**
 * Turn-level grounding port.
 *
 * `MeetingConfig.context` pins passages for the whole meeting, which is right
 * for material every participant needs (prior minutes, the objective's source
 * document). It is wrong for the thing an agent actually needs on *its* turn:
 * the analyst reaching for a clause and the engineer reaching for a migration
 * note want different passages, and neither is knowable when the meeting is
 * created.
 *
 * So retrieval is a port, not a field. The engine never learns what a document
 * or an index is — it asks for passages before a turn and passes back what it
 * gets. The Postgres/RAG implementation lives in
 * `apps/web/src/server/collab/grounding.ts`.
 */

import type { AgentPersona, ChannelMessage } from "./types";

/** One retrieved passage, with enough provenance to cite it in the transcript. */
export interface GroundingSource {
  /** Human-readable origin, e.g. `Northwind MSA · p.12`. */
  label: string;
  documentId?: string;
  page?: number;
  /** Retriever score, when the implementation exposes one. */
  score?: number;
  /**
   * Truncated copy of the passage the turn actually saw.
   *
   * Storing it costs log size, and buys the two things the log exists for: a
   * reader can check a figure without the index still being around, and the
   * evaluator can tell a cited number from an invented one. A meeting grounded
   * purely by retrieval would otherwise be unscoreable, because the passages
   * that justified it lived only in a prompt that no longer exists.
   */
  excerpt?: string;
}

/** Keeps a grounded transcript auditable without turning it into a corpus. */
export const MAX_EXCERPT_CHARS = 320;

export function toExcerpt(passage: string, limit = MAX_EXCERPT_CHARS): string {
  const flat = passage.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export interface TurnGrounding {
  /** Passages injected into this turn's system prompt, highest value first. */
  passages: string[];
  /** Recorded on the produced message so the UI can show what was consulted. */
  sources?: GroundingSource[];
}

export interface TurnGroundingRequest {
  meetingId: string;
  /** The persona about to speak. Its role is the strongest query signal. */
  persona: AgentPersona;
  objective: string;
  agenda: string[];
  /** Full transcript so far, oldest first. */
  transcript: ChannelMessage[];
  turnIndex: number;
}

export interface TurnGroundingProvider {
  /**
   * Passages for this turn. Implementations must be side-effect free and
   * should return empty rather than throw — the orchestrator treats a failure
   * as "no extra grounding", never as a failed turn.
   */
  retrieve(request: TurnGroundingRequest): Promise<TurnGrounding>;
}

export const EMPTY_GROUNDING: TurnGrounding = { passages: [] };

/**
 * Builds the retrieval query for a turn.
 *
 * Exported because it is the part worth tuning and worth testing directly: the
 * persona's role carries what this participant is *for*, the objective carries
 * what the meeting is for, and the last substantive message carries what was
 * just asked. Weighting all three beats querying on any one of them, and
 * querying on the whole transcript retrieves the meeting's own chatter back.
 */
export function buildGroundingQuery(request: TurnGroundingRequest): string {
  const parts = [request.persona.role, request.objective];

  for (let i = request.transcript.length - 1; i >= 0; i--) {
    const message = request.transcript[i]!;
    if (message.kind === "system") continue;
    parts.push(message.text.slice(0, 600));
    break;
  }

  // Agenda only when nothing has been said yet — once the conversation is
  // moving, the last message is a far better signal than the whole agenda.
  if (request.transcript.every((m) => m.kind === "system") && request.agenda.length > 0) {
    parts.push(request.agenda.join(" "));
  }

  return parts
    .filter((p) => typeof p === "string" && p.trim().length > 0)
    .join(" ")
    .slice(0, 1200);
}
