/**
 * AI-assisted note capture from highlighted text.
 *
 * Three intents:
 *   - summary  → distill the selection into 2–4 punchy sentences
 *   - action   → reformat as a single, concrete action item (or a bullet list)
 *   - decision → reformat as a decision with the rationale + dissenting view
 *
 * Returns plain markdown so the editor can parse-on-open. Markdown is also
 * what `embed-note.ts` prefers, so embeddings ride on the AI output without
 * an extra round-trip.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "~/lib/models";
import { normalizeModelContent } from "~/app/api/agents/documentQ&A/services";

export type AiCaptureIntent = "summary" | "action" | "decision";

interface CaptureArgs {
  selection: string;
  intent: AiCaptureIntent;
  /** Optional surrounding context the LLM can use as a hint. */
  documentTitle?: string | null;
  page?: number | null;
}

const SYSTEM_PROMPT_BY_INTENT: Record<AiCaptureIntent, string> = {
  summary: `You convert a highlighted passage into a tight study note.
Rules:
- 2 to 4 sentences. Plain English, no marketing tone.
- Lead with the main idea. Strip filler.
- Preserve specific names, numbers, and dates exactly.
- Output markdown only — no preamble, no quotes around the answer.`,

  action: `You convert a highlighted passage into a concrete action item.
Rules:
- Start with a verb. Be specific about what, who (if mentioned), and by when (if mentioned).
- One action per line. Use a markdown checkbox: \`- [ ] do X\`.
- If there is no clear action, output exactly: \`- [ ] (no clear action — review source)\`
- Markdown only.`,

  decision: `You convert a highlighted passage into a decision log entry.
Format (markdown):
**Decision:** <one sentence>
**Why:** <reasoning, 1–2 sentences>
**Counterpoint:** <the strongest dissent or open question, 1 sentence>
- Preserve named parties and dates exactly.
- If the passage isn't a decision, write \`Decision: (none — observation only)\` and skip the other lines.
Output markdown only — no preamble.`,
};

const SUGGESTED_TITLE: Record<AiCaptureIntent, string> = {
  summary: "Summary",
  action: "Action item",
  decision: "Decision",
};

export interface CaptureResult {
  markdown: string;
  suggestedTitle: string;
}

export async function captureFromSelection(
  args: CaptureArgs,
): Promise<CaptureResult> {
  const { selection, intent } = args;
  const trimmed = selection.trim();
  if (!trimmed) {
    return { markdown: "", suggestedTitle: SUGGESTED_TITLE[intent] };
  }

  const contextLine =
    args.documentTitle || args.page
      ? `Source: ${[args.documentTitle, args.page ? `page ${args.page}` : null]
          .filter(Boolean)
          .join(", ")}\n\n`
      : "";

  const llm = getChatModel("gpt-4o");
  const reply = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT_BY_INTENT[intent]),
    new HumanMessage(`${contextLine}Passage:\n\n"""\n${trimmed}\n"""`),
  ]);
  const markdown = normalizeModelContent(reply.content).trim();

  return {
    markdown,
    suggestedTitle: SUGGESTED_TITLE[intent],
  };
}
