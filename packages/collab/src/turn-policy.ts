/**
 * Speaker selection. Every policy is a pure function of (participants,
 * transcript, turnIndex) so a meeting replays identically from its log —
 * which is what makes the distributed case debuggable.
 */

import type { AgentPersona, ChannelMessage, TurnPolicy } from "./types";

export interface SelectSpeakerInput {
    participants: AgentPersona[];
    transcript: ChannelMessage[];
    turnIndex: number;
    policy: TurnPolicy;
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

/**
 * Returns the persona that speaks next, or null when no one can.
 *
 * `moderated` gives the moderator the first and every-other turn unless the
 * previous message nominated someone with `@id`; `reactive` follows explicit
 * mentions first and falls back to role-word overlap; `round_robin` ignores
 * the transcript entirely.
 */
export function selectNextSpeaker(input: SelectSpeakerInput): AgentPersona | null {
    const { participants, transcript, turnIndex, policy } = input;
    if (participants.length === 0) return null;

    switch (policy.kind) {
        case "round_robin":
            return participants[turnIndex % participants.length]!;

        case "moderated": {
            const moderator =
                participants.find(p => p.id === policy.moderatorId) ?? participants[0]!;
            if (turnIndex === 0) return moderator;

            const last = lastAgentOrHumanMessage(transcript);
            if (last) {
                const nominated = findMention(last.text, participants, last.author.id);
                if (nominated) return nominated;
            }
            // No nomination — hand the floor back to the moderator so it can
            // redirect rather than letting the meeting stall.
            const lastSpeakerId = last?.author.onBehalfOfPersonaId ?? last?.author.id;
            if (lastSpeakerId === moderator.id) {
                const others = participants.filter(p => p.id !== moderator.id);
                return (
                    others[Math.floor((turnIndex - 1) / 2) % Math.max(others.length, 1)] ??
                    moderator
                );
            }
            return moderator;
        }

        case "reactive": {
            const last = lastAgentOrHumanMessage(transcript);
            if (!last) return participants[0]!;

            const lastSpeakerId = last.author.onBehalfOfPersonaId ?? last.author.id;
            const mentioned = findMention(last.text, participants, lastSpeakerId);
            if (mentioned) return mentioned;

            const words = new Set(tokenize(last.text));
            let best: AgentPersona | null = null;
            let bestScore = 0;
            for (const p of participants) {
                if (p.id === lastSpeakerId) continue;
                const roleWords = tokenize(`${p.role} ${p.displayName}`);
                const score = roleWords.reduce((s, w) => s + (words.has(w) ? 1 : 0), 0);
                if (score > bestScore) {
                    best = p;
                    bestScore = score;
                }
            }
            if (best) return best;

            // Nothing matched — fall back to strict rotation so every persona is
            // guaranteed airtime rather than letting one voice dominate.
            const idx = participants.findIndex(p => p.id === lastSpeakerId);
            return participants[(idx + 1 + participants.length) % participants.length]!;
        }
    }
}

function findMention(
    text: string,
    participants: AgentPersona[],
    excludeId?: string
): AgentPersona | null {
    for (const match of text.matchAll(/@([a-zA-Z0-9_-]+)/g)) {
        const id = match[1]!;
        if (id === excludeId) continue;
        const hit = participants.find(p => p.id === id);
        if (hit) return hit;
    }
    return null;
}
