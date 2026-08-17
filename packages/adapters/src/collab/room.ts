/**
 * Rooms — ask every member at once, and let each answer from its own context.
 *
 * A meeting is a conversation: one speaker at a time, elected from the
 * transcript, working toward a close. A room is a *query*: one question, every
 * member, concurrently, no floor to hold. The two share a channel log and
 * nothing else, which is why this is a function rather than another method on
 * `MeetingOrchestrator`.
 *
 * Three reasons it cannot be one:
 *
 * 1. `stepInner` marks the whole meeting `failed` when no runtime serves a
 *    persona. For a room that is the ordinary case — a member whose machine is
 *    offline — and it has to settle as that member's message, not a dead round.
 * 2. A meeting carries state between turns (turn index, next speaker,
 *    controller, status). A room carries none: every round is derivable from
 *    the log, so there is nothing to persist and nothing to keep in sync.
 * 3. `maxConsecutiveFailures` is meaningful for a conversation and actively
 *    wrong for a fan-out, where one member failing says nothing about the rest.
 *
 * The value of a room is proportional to the information its members do *not*
 * share. Members that read the same corpus produce the same answer six times;
 * members bound to different document sets, repos or machines produce something
 * no single context could.
 */

import type { AgentRuntime, TurnContext } from "./agent";
import type { Clock, IdFactory } from "./clock";
import { randomIdFactory, systemClock } from "./clock";
import type { TurnGroundingProvider } from "./grounding";
import type { ChannelStore } from "./store";
import type { AgentPersona, ChannelMessage, MessageAuthor } from "./types";

/** Emitted on its own line by a member that cannot answer. Never stored. */
export const ROOM_DECLINE_MARKER = "NO_ANSWER";

/** Wall-clock budget per member. Below the hub's 120s so remote work isn't discarded. */
export const DEFAULT_MEMBER_TIMEOUT_MS = 90_000;

export interface RoomConfig {
  id: string;
  channelId: string;
  workspaceId: string;
  name: string;
  /** What the room is for. Injected into every member's prompt. */
  purpose?: string;
  /** Frozen at creation, exactly like a meeting's participants. */
  members: AgentPersona[];
  /** Passages pinned for every member, regardless of their own sources. */
  context?: string[];
}

export type RoomAnswerStatus = "answered" | "declined" | "failed" | "timeout" | "unserved";

export interface RoomAnswer {
  memberId: string;
  status: RoomAnswerStatus;
  /** Always present — a failure is a message too, so the round stays readable. */
  message: ChannelMessage;
  latencyMs: number;
  error?: string;
}

export interface AskRoomResult {
  roundId: string;
  question: ChannelMessage;
  /** One per asked member, in roster order — never arrival order. */
  answers: RoomAnswer[];
}

export interface AskRoomInput {
  store: ChannelStore;
  room: RoomConfig;
  /** Consulted in order; first that `serves()` wins. Same contract as meetings. */
  runtimes: AgentRuntime[];
  question: { text: string; author: MessageAuthor };
  /** Subset to ask. Defaults to every member. */
  memberIds?: string[];
  timeoutMs?: number;
  /** Members in flight at once. Bounded so a large room cannot stampede. */
  concurrency?: number;
  groundingProvider?: TurnGroundingProvider;
  onGroundingError?: (error: Error, memberId: string) => void;
  clock?: Clock;
  newId?: IdFactory;
}

/** Round bookkeeping carried on the question message. */
export interface RoomRoundMeta {
  id: string;
  expected: string[];
}

/** A round reconstructed from the log. The API and the UI share this. */
export interface RoomRound {
  id: string;
  questionSeq: number;
  text: string;
  askedBy: MessageAuthor;
  askedAt: string;
  expected: string[];
  settled: Array<{ memberId: string; status: RoomAnswerStatus; seq: number }>;
  pending: string[];
  complete: boolean;
}

/**
 * Strips the decline marker and reports whether it was present.
 *
 * Mirrors `extractCompletion`: the marker is control flow, not conversation,
 * and never reaches the transcript.
 */
export function extractDecline(
  text: string,
  marker: string = ROOM_DECLINE_MARKER,
): { text: string; declined: boolean } {
  if (!text.includes(marker)) return { text: text.trim(), declined: false };
  const stripped = text.split(marker).join("").replace(/\n{3,}/g, "\n\n").trim();
  return { text: stripped, declined: true };
}

/**
 * The slice of a meeting's `TurnContext` a room member needs.
 *
 * Reusing the type rather than inventing a parallel one is what keeps every
 * existing runtime — local, scripted, remote worker — usable in a room with no
 * changes. `maxTurns: 1` is literally true here: a member speaks once.
 */
export function buildRoomTurnContext(room: RoomConfig, retrieved: string[] = []): TurnContext {
  return {
    meetingId: room.id,
    title: room.name,
    objective: room.purpose ?? `Answer the question asked in ${room.name}.`,
    agenda: [],
    context: [...(room.context ?? []), ...retrieved],
    roster: room.members.map((m) => ({ id: m.id, displayName: m.displayName, role: m.role })),
    turnIndex: 0,
    maxTurns: 1,
    completionMarker: ROOM_DECLINE_MARKER,
    mode: "room",
  };
}

// ---------------------------------------------------------------------------

/** Runs `tasks` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Asks every member and appends each answer as it lands.
 *
 * Resolves once every asked member has settled. It never rejects: a member that
 * throws, times out, or has no runtime becomes one message with a `system`
 * kind, so the round always produces a complete, readable record.
 */
export async function askRoom(input: AskRoomInput): Promise<AskRoomResult> {
  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? randomIdFactory;
  const timeoutMs = input.timeoutMs ?? DEFAULT_MEMBER_TIMEOUT_MS;

  const asked = input.memberIds
    ? input.room.members.filter((m) => input.memberIds!.includes(m.id))
    : [...input.room.members];
  if (asked.length === 0) throw new Error("A room round needs at least one member");

  const roundId = newId("round");
  const round: RoomRoundMeta = { id: roundId, expected: asked.map((m) => m.id) };

  // Appended and awaited before any member runs, so the question always
  // precedes every answer in the log. Answer order is arrival order and
  // deliberately not stable — that is what "they answer as they finish" means.
  const question = await input.store.append({
    channelId: input.room.channelId,
    author: input.question.author,
    text: input.question.text,
    kind: "chat",
    meta: { roomId: input.room.id, round },
  });

  const answers = await mapWithConcurrency(asked, input.concurrency ?? 8, (member) =>
    settleMember({ input, member, question, roundId, timeoutMs, clock }),
  );

  return { roundId, question, answers };
}

interface SettleInput {
  input: AskRoomInput;
  member: AgentPersona;
  question: ChannelMessage;
  roundId: string;
  timeoutMs: number;
  clock: Clock;
}

/** Runs one member to a settled outcome. Never throws. */
async function settleMember(args: SettleInput): Promise<RoomAnswer> {
  const { input, member, question, roundId, timeoutMs } = args;
  const startedAt = Date.now();

  const record = async (
    status: RoomAnswerStatus,
    text: string,
    meta: Record<string, unknown>,
    error?: string,
  ): Promise<RoomAnswer> => {
    const latencyMs = Date.now() - startedAt;
    const message = await input.store.append({
      channelId: input.room.channelId,
      author: { kind: "agent", id: member.id, displayName: member.displayName },
      // Answers and declines are content; the three failure states are not.
      // Keeping that distinction in `kind` is what stops the Slack bridge, the
      // minutes extractor and the eval harness reading an error as an answer.
      kind: status === "answered" || status === "declined" ? "chat" : "system",
      text,
      meta: { roomId: input.room.id, roundId, memberId: member.id, status, latencyMs, ...meta },
    });
    return { memberId: member.id, status, message, latencyMs, error };
  };

  const runtime = input.runtimes.find((r) => r.serves(member)) ?? null;
  if (!runtime) {
    // Normal in a room — a member whose node is offline. Not a failed round.
    return record("unserved", `@${member.id} is not reachable right now.`, {});
  }

  let grounding: { passages: string[]; sources?: unknown } = { passages: [] };
  if (input.groundingProvider) {
    try {
      grounding = await input.groundingProvider.retrieve({
        meetingId: input.room.id,
        persona: member,
        objective: question.text,
        agenda: [],
        transcript: [question],
        turnIndex: 0,
      });
    } catch (err) {
      input.onGroundingError?.(
        err instanceof Error ? err : new Error(String(err)),
        member.id,
      );
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      // Members receive the question ONLY, never the channel history. If they
      // saw each other's answers the first to finish would anchor the rest,
      // and it would stop being a fan-out.
      runtime.takeTurn({
        persona: member,
        context: buildRoomTurnContext(input.room, grounding.passages),
        transcript: [question],
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RoomTimeout()), timeoutMs);
        timer.unref?.();
      }),
    ]);

    const { text, declined } = extractDecline(result.text.trim());
    const meta = {
      ...(grounding.sources ? { grounding: grounding.sources } : {}),
      ...result.meta,
    };

    if (declined || text.length === 0 || result.meta?.declined === true) {
      return record("declined", text.length > 0 ? text : "No answer from my sources.", {
        ...meta,
        declined: true,
      });
    }
    return record("answered", text, meta);
  } catch (err) {
    if (err instanceof RoomTimeout) {
      // The runtime promise is abandoned rather than cancelled — `takeTurn`
      // takes no AbortSignal. A remote turn is still bounded by the hub's own
      // timer, so this leaks nothing; it just resolves into the void.
      return record(
        "timeout",
        `@${member.id} did not answer within ${Math.round(timeoutMs / 1000)}s.`,
        { timeoutMs },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return record("failed", `@${member.id} could not answer (${detail}).`, {}, detail);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class RoomTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "RoomTimeout";
  }
}

// ---------------------------------------------------------------------------

function readRoundMeta(message: ChannelMessage): RoomRoundMeta | null {
  const round = (message.meta as { round?: unknown } | undefined)?.round;
  if (!round || typeof round !== "object") return null;
  const { id, expected } = round as { id?: unknown; expected?: unknown };
  if (typeof id !== "string" || !Array.isArray(expected)) return null;
  return { id, expected: expected.filter((e): e is string => typeof e === "string") };
}

/**
 * Reconstructs every round from a channel log.
 *
 * The round has no row of its own: the question carries its id and roster, each
 * answer carries the round id and its status. Deriving rather than storing is
 * what keeps a room stateless — there is no second copy to fall out of sync
 * with the log, which is the same rule meetings follow.
 */
export function summarizeRounds(messages: ChannelMessage[]): RoomRound[] {
  const rounds = new Map<string, RoomRound>();

  for (const message of messages) {
    const round = readRoundMeta(message);
    if (!round) continue;
    rounds.set(round.id, {
      id: round.id,
      questionSeq: message.seq,
      text: message.text,
      askedBy: message.author,
      askedAt: message.ts,
      expected: round.expected,
      settled: [],
      pending: [...round.expected],
      complete: round.expected.length === 0,
    });
  }

  for (const message of messages) {
    const meta = message.meta as
      | { roundId?: unknown; memberId?: unknown; status?: unknown }
      | undefined;
    if (typeof meta?.roundId !== "string" || typeof meta.memberId !== "string") continue;
    const round = rounds.get(meta.roundId);
    if (!round) continue;

    const status = typeof meta.status === "string" ? (meta.status as RoomAnswerStatus) : "answered";
    round.settled.push({ memberId: meta.memberId, status, seq: message.seq });
    round.pending = round.pending.filter((id) => id !== meta.memberId);
    round.complete = round.pending.length === 0;
  }

  return [...rounds.values()].sort((a, b) => a.questionSeq - b.questionSeq);
}
