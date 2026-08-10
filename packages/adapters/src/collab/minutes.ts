/**
 * Deterministic meeting minutes.
 *
 * Extraction is rule-based on purpose: minutes are the artefact people audit,
 * and an LLM summary that quietly invents a decision is worse than no summary.
 * `summarizeMinutes` produces a prompt for an optional LLM pass on top, but
 * the decisions and action items themselves always come from real messages.
 */

import type { ActionItem, ChannelMessage, MeetingConfig, MeetingMinutes, MeetingState } from "./types";

const DECISION_CUES = [
  "we'll go with",
  "we will go with",
  "decision:",
  "decided:",
  "we're going with",
  "we are going with",
  "let's ship",
  "lets ship",
  "agreed:",
  "we agree",
  "final call",
  "locking in",
  "we'll proceed with",
];

const ACTION_CUES = [
  "action item",
  "i'll take",
  "i will take",
  "i'll own",
  "i will own",
  "will own",
  "takes point on",
  "todo:",
  "to do:",
  "next step:",
  "follow up:",
  "follow-up:",
  "by friday",
  "by monday",
  "by end of week",
];

/** Splits a message into sentences without dragging in an NLP dependency. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function matchesCue(sentence: string, cues: string[]): boolean {
  const lower = sentence.toLowerCase();
  return cues.some((c) => lower.includes(c));
}

/**
 * Who the work lands on: an explicit `@id`, a named participant, or — for
 * first-person commitments ("I'll own the migration") — whoever said it.
 */
function inferOwner(
  sentence: string,
  participants: Array<{ id: string; displayName: string }>,
  speakerId?: string,
): string | undefined {
  const mention = /@([a-zA-Z0-9_-]+)/.exec(sentence);
  if (mention) {
    const hit = participants.find((p) => p.id === mention[1]);
    if (hit) return hit.id;
  }
  for (const p of participants) {
    if (sentence.toLowerCase().includes(p.displayName.toLowerCase())) return p.id;
  }
  if (/\bi'?(?:ll|m| will| am)\b/i.test(sentence) && speakerId) {
    return participants.some((p) => p.id === speakerId) ? speakerId : undefined;
  }
  return undefined;
}

export function buildMinutes(
  config: MeetingConfig,
  state: MeetingState,
  transcript: ChannelMessage[],
): MeetingMinutes {
  const roster = config.participants.map((p) => ({ id: p.id, displayName: p.displayName }));
  const chat = transcript.filter((m) => m.kind === "chat");

  const perParticipant = new Map<string, number>();
  for (const m of chat) {
    const id = m.author.onBehalfOfPersonaId ?? m.author.id;
    perParticipant.set(id, (perParticipant.get(id) ?? 0) + 1);
  }

  const decisions: MeetingMinutes["decisions"] = [];
  const actionItems: ActionItem[] = [];

  for (const m of chat) {
    for (const s of sentences(m.text)) {
      if (matchesCue(s, DECISION_CUES) && decisions.length < 25) {
        decisions.push({ text: s, sourceSeq: m.seq, author: m.author.displayName });
      } else if (matchesCue(s, ACTION_CUES) && actionItems.length < 25) {
        const speakerId = m.author.onBehalfOfPersonaId ?? m.author.id;
        actionItems.push({ text: s, owner: inferOwner(s, roster, speakerId), sourceSeq: m.seq });
      }
    }
  }

  const humanInterventions = transcript.filter((m) => m.author.kind === "human").length;

  return {
    meetingId: config.id,
    title: config.title,
    objective: config.objective,
    status: state.status,
    turnsTaken: state.turnIndex,
    participants: config.participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role,
      messages: perParticipant.get(p.id) ?? 0,
    })),
    decisions,
    actionItems,
    summary: extractiveSummary(config, chat),
    humanInterventions,
  };
}

/**
 * Picks the highest-signal sentence from each speaker's longest contribution.
 * Extractive by design — every word in the summary was said by someone.
 */
function extractiveSummary(config: MeetingConfig, chat: ChannelMessage[]): string {
  if (chat.length === 0) return `No discussion took place. Objective: ${config.objective}`;

  const bySpeaker = new Map<string, ChannelMessage[]>();
  for (const m of chat) {
    const id = m.author.onBehalfOfPersonaId ?? m.author.id;
    const list = bySpeaker.get(id) ?? [];
    list.push(m);
    bySpeaker.set(id, list);
  }

  const lines: string[] = [];
  for (const [id, messages] of bySpeaker) {
    const longest = messages.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const best = sentences(longest.text).reduce(
      (a, b) => (scoreSentence(b) > scoreSentence(a) ? b : a),
      sentences(longest.text)[0] ?? longest.text,
    );
    const name =
      config.participants.find((p) => p.id === id)?.displayName ?? longest.author.displayName;
    lines.push(`${name}: ${best}`);
  }
  return lines.join("\n");
}

/** Numbers, comparatives, and length are cheap proxies for substance. */
function scoreSentence(s: string): number {
  const numbers = (s.match(/\d/g) ?? []).length;
  const comparatives = /\b(because|instead|versus|vs|trade[- ]?off|risk|cost|deadline|blocked)\b/i.test(s)
    ? 3
    : 0;
  return Math.min(s.length / 40, 4) + numbers * 0.5 + comparatives;
}

/**
 * Prompt for an optional LLM pass that turns raw minutes into prose. Kept
 * here so hosts do not reinvent it, but the engine never calls it itself.
 */
export function summarizeMinutesPrompt(minutes: MeetingMinutes): string {
  return [
    `Write the minutes for "${minutes.title}".`,
    `Objective: ${minutes.objective}`,
    "",
    "Decisions actually made:",
    ...(minutes.decisions.length > 0
      ? minutes.decisions.map((d) => `- ${d.text} (${d.author})`)
      : ["- none recorded"]),
    "",
    "Action items:",
    ...(minutes.actionItems.length > 0
      ? minutes.actionItems.map((a) => `- ${a.text}${a.owner ? ` — owner @${a.owner}` : ""}`)
      : ["- none recorded"]),
    "",
    "Key points:",
    minutes.summary,
    "",
    "Rules: use only the material above. Do not add decisions, owners, or dates that are not listed.",
  ].join("\n");
}
