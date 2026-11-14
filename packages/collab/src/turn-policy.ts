/**
 * Speaker selection. Every policy is a pure function of (participants,
 * transcript, turnIndex) so a meeting replays identically from its log —
 * which is what makes the distributed case debuggable.
 *
 * `participants` is the room the turn is chosen from: a phase's speakers, or
 * everyone when the meeting has no phases. `turnIndex` counts the turns taken
 * since that room opened, so the room's turns so far are the last `turnIndex`
 * turn-taking messages of the transcript (see `seatOf`). That is all the
 * state the policies need to give every seat a turn before anyone repeats.
 */

import type { AgentPersona, ChannelMessage, TurnPolicy } from "./types";

export interface SelectSpeakerInput {
    participants: AgentPersona[];
    transcript: ChannelMessage[];
    turnIndex: number;
    policy: TurnPolicy;
    /**
     * Turns the meeting has left, this one included. Under `moderated` the
     * chair takes the last one, and keeps its seat for it when the round in
     * progress cannot finish first. Omitted, nobody closes.
     */
    turnsLeft?: number;
}

/** Words that carry no signal when matching a message against a persona's role. */
const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "we",
    "i",
    "you",
    "it",
    "is",
    "are",
    "be",
    "this",
    "that",
    "our",
    "your",
    "what",
    "how",
    "should",
    "would",
    "can",
    "will",
    "do",
    "does",
    "need",
    "needs",
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function lastAgentOrHumanMessage(transcript: ChannelMessage[]): ChannelMessage | undefined {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const m = transcript[i]!;
        if (m.kind !== "system") return m;
    }
    return undefined;
}

/** After a mention: the comma or colon of "@engineer, what does it cost?" */
const VOCATIVE = /^\)?\s*[,:，：—–]/;
/** A sentence boundary; a decimal point ("$1.42M") is not one. */
const SENTENCE_BOUNDARY = /[.!?](?=\s|$)|[。！？\n]/g;
const MENTION = /@([a-zA-Z0-9_-]+)/g;

/**
 * A message's mentions split by what they do. `asked` hands someone the
 * floor: "@engineer, what does it cost?", a sentence that opens with the
 * handle, or the last handle in a question ("can @finance confirm the 44%?").
 * `named` only refers to someone ("Thanks @analyst", "@critic's challenge").
 * Text order within each; the author's own handle is dropped.
 */
function mentionGroups(text: string, authorId?: string): { asked: string[]; named: string[] } {
    const boundaries = [...text.matchAll(SENTENCE_BOUNDARY)].map(match => match.index);
    const mentions = [...text.matchAll(MENTION)];
    const asked: string[] = [];
    const named: string[] = [];
    mentions.forEach((match, k) => {
        const id = match[1]!;
        if (id === authorId) return;
        const start = match.index;
        const end = start + match[0].length;
        const after = text.slice(end);
        const sentenceStart = boundaries.filter(b => b < start).at(-1) ?? -1;
        const sentenceEnd = boundaries.find(b => b >= end) ?? text.length;
        const possessive = /^['’]s\b/.test(after);
        const opensSentence =
            !possessive && /^[\s\-*•>"“(]*$/.test(text.slice(sentenceStart + 1, start));
        const question = /[?？]/.test(text[sentenceEnd] ?? "");
        const lastInSentence = (mentions[k + 1]?.index ?? Infinity) >= sentenceEnd;
        const handsOver =
            VOCATIVE.test(after) || opensSentence || (question && lastInSentence && !possessive);
        const list = handsOver ? asked : named;
        if (!list.includes(id)) list.push(id);
    });
    return { asked, named: named.filter(id => !asked.includes(id)) };
}

/** Mentions in the order they hand over the floor: asked first, then named. */
export function rankedMentions(text: string, authorId?: string): string[] {
    const { asked, named } = mentionGroups(text, authorId);
    return [...asked, ...named];
}

/**
 * The persona whose turn a message used, or null for a message that takes no
 * turn. An agent's chat message is its own turn, a human speaking through a
 * seat uses that seat's turn, and a failed turn still spent the seat's turn —
 * the orchestrator posts it and passes the floor on.
 */
export function seatOf(message: ChannelMessage): string | null {
    if (message.kind === "chat") {
        if (message.author.kind === "agent") {
            return message.author.id === "system" ? null : message.author.id;
        }
        return message.author.onBehalfOfPersonaId ?? null;
    }
    if (message.kind === "system" && message.meta?.event === "turn_failed") {
        const personaId = message.meta.personaId;
        return typeof personaId === "string" ? personaId : null;
    }
    return null;
}

export interface RoomRound {
    /** Seats that have spoken in the round in progress. Empty when a round is about to open. */
    heard: Set<string>;
    /** Seats still to speak in the round, in seating order. Never empty. */
    waiting: AgentPersona[];
    /** Seat of the latest turn anywhere in the transcript, this room or the one before. */
    lastSeat: string | null;
    /**
     * Transcript position from which a nomination still stands: the turn that
     * handed the floor into this round. A question the chair put before the
     * round opened is still owed an answer inside it.
     */
    since: number;
}

/**
 * Where the room stands. A round is complete once every seat in the room has
 * spoken; the next turn opens a new one. Seats outside the room (a human
 * speaking through an agent who is not in this phase) take a turn without
 * counting towards the round.
 */
export function roomRound(
    participants: readonly AgentPersona[],
    transcript: readonly ChannelMessage[],
    turnIndex: number
): RoomRound {
    const seatIds = new Set(participants.map(p => p.id));
    const turnPositions: number[] = [];
    transcript.forEach((message, position) => {
        if (seatOf(message)) turnPositions.push(position);
    });
    const roomTurns = turnIndex > 0 ? turnPositions.slice(-turnIndex) : [];
    const firstRoomTurn = turnPositions.length - roomTurns.length;

    let heard = new Set<string>();
    let roundStart = 0;
    roomTurns.forEach((position, k) => {
        const seat = seatOf(transcript[position]!)!;
        if (!seatIds.has(seat)) return;
        heard.add(seat);
        if (heard.size === seatIds.size) {
            heard = new Set();
            roundStart = k + 1;
        }
    });

    const handoff = firstRoomTurn + roundStart - 1;
    const lastPosition = turnPositions.at(-1);
    return {
        heard,
        waiting: participants.filter(p => !heard.has(p.id)),
        lastSeat: lastPosition === undefined ? null : seatOf(transcript[lastPosition]!),
        since: handoff >= 0 ? turnPositions[handoff]! : 0,
    };
}

/**
 * The standing nomination of one of `candidates`. Hand-offs come first,
 * newest message first, so "Thanks @critic. @analyst, answer the challenge"
 * goes to the analyst and a question the chair put two turns ago is still
 * answered. A plain mention counts only from the chair ("then @engineer and
 * @analyst"): from anyone else it is a reference or a thank-you, not a
 * direction. Someone who has already spoken this round is never a candidate.
 */
function nominee(
    transcript: readonly ChannelMessage[],
    since: number,
    candidates: readonly AgentPersona[],
    chairId: string
): AgentPersona | null {
    const newestFirst: { seat: string; asked: string[]; named: string[] }[] = [];
    for (let i = transcript.length - 1; i >= since; i--) {
        const message = transcript[i]!;
        if (message.kind === "system") continue;
        const seat = seatOf(message) ?? message.author.id;
        newestFirst.push({ seat, ...mentionGroups(message.text, seat) });
    }
    const pick = (ids: string[]) => ids.map(id => candidates.find(p => p.id === id)).find(Boolean);
    for (const message of newestFirst) {
        const hit = pick(message.asked);
        if (hit) return hit;
    }
    for (const message of newestFirst) {
        if (message.seat !== chairId) continue;
        const hit = pick(message.named);
        if (hit) return hit;
    }
    return null;
}

/**
 * A person outranks the turn order: when the latest message is a human's and
 * it names someone in the room, that agent answers next even if it has
 * already spoken this round.
 */
function addressedByHuman(
    transcript: ChannelMessage[],
    participants: AgentPersona[]
): AgentPersona | null {
    const last = lastAgentOrHumanMessage(transcript);
    if (last?.author.kind !== "human") return null;
    for (const id of rankedMentions(last.text, last.author.onBehalfOfPersonaId)) {
        const hit = participants.find(p => p.id === id);
        if (hit) return hit;
    }
    return null;
}

/** Seats still waiting, without the one that just spoke unless it is the only one. */
function candidatesFrom(round: RoomRound): AgentPersona[] {
    const others = round.waiting.filter(p => p.id !== round.lastSeat);
    return others.length > 0 ? others : round.waiting;
}

/**
 * Returns the persona that speaks next, or null when no one can.
 *
 * Under `moderated` and `reactive` the room works in rounds: everyone in it
 * speaks once before anyone speaks again, and nobody speaks twice in a row
 * while someone else is waiting. Within a round, `moderated` follows the
 * latest nomination of someone still waiting, then seating order; the chair
 * opens each round it did not just speak before, otherwise speaks last, and
 * takes the meeting's final turn. `reactive` follows a mention, then the
 * closest role, then the seat after the last speaker. `round_robin` ignores
 * the transcript entirely. A human naming an agent always gets that agent.
 */
export function selectNextSpeaker(input: SelectSpeakerInput): AgentPersona | null {
    const { participants, transcript, turnIndex, policy, turnsLeft } = input;
    if (participants.length === 0) return null;

    switch (policy.kind) {
        case "round_robin":
            return participants[turnIndex % participants.length]!;

        case "moderated": {
            const asked = addressedByHuman(transcript, participants);
            if (asked) return asked;

            const chairId = policy.moderatorId ?? participants[0]!.id;
            const chair = participants.find(p => p.id === chairId) ?? null;
            const round = roomRound(participants, transcript, turnIndex);

            // The chair closes: the meeting's last turn lands the decision.
            if (chair && turnsLeft === 1 && round.lastSeat !== chair.id) return chair;

            let candidates = candidatesFrom(round);
            if (chair && candidates.includes(chair)) {
                const others = candidates.filter(p => p !== chair);
                const closesThisRound =
                    turnsLeft !== undefined && turnsLeft <= round.waiting.length;
                if (closesThisRound && others.length > 0) {
                    // Hold the chair's seat for the close so the round still fits.
                    candidates = others;
                } else if (round.heard.size === 0) {
                    return chair;
                } else {
                    // A chair that did not open the round speaks last in it.
                    candidates = [...others, chair];
                }
            }
            return nominee(transcript, round.since, candidates, chairId) ?? candidates[0]!;
        }

        case "reactive": {
            const asked = addressedByHuman(transcript, participants);
            if (asked) return asked;

            const last = lastAgentOrHumanMessage(transcript);
            const round = roomRound(participants, transcript, turnIndex);
            const candidates = candidatesFrom(round);
            if (!last) return candidates[0]!;

            const lastSpeakerId = last.author.onBehalfOfPersonaId ?? last.author.id;
            for (const id of rankedMentions(last.text, lastSpeakerId)) {
                const hit = candidates.find(p => p.id === id);
                if (hit) return hit;
            }

            const words = new Set(tokenize(last.text));
            let best: AgentPersona | null = null;
            let bestScore = 0;
            for (const p of candidates) {
                const roleWords = tokenize(`${p.role} ${p.displayName}`);
                const score = roleWords.reduce((s, w) => s + (words.has(w) ? 1 : 0), 0);
                if (score > bestScore) {
                    best = p;
                    bestScore = score;
                }
            }
            if (best) return best;

            // Nothing matched: the next seat after the last speaker that is still waiting.
            const from = participants.findIndex(p => p.id === round.lastSeat);
            for (let step = 1; step <= participants.length; step++) {
                const next =
                    participants[(from + step + participants.length) % participants.length]!;
                if (candidates.includes(next)) return next;
            }
            return candidates[0]!;
        }
    }
}
