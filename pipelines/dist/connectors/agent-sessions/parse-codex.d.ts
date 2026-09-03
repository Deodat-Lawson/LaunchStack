/**
 * Codex rollout parser.
 *
 * A rollout file interleaves two recordings of the same conversation: the
 * model-facing `response_item` stream (messages, reasoning, tool calls) and
 * the UI-facing `event_msg` stream (user_message / agent_message events plus
 * progress noise). Importing both would duplicate every turn, so the parser
 * prefers `response_item` and only falls back to the event stream for a role
 * the response stream never recorded — older CLI versions logged some turns
 * only as events.
 */
import { type NormalizedSession } from "./types.js";
/**
 * Message and tool-output content arrives either as a plain string, as an
 * array of `{type: "input_text" | "output_text" | "text", text}` blocks, or —
 * for tool outputs — as a string that itself JSON-encodes such an array.
 */
export declare function extractCodexText(content: unknown): string;
export declare function parseCodexSession(raw: string): NormalizedSession;
//# sourceMappingURL=parse-codex.d.ts.map