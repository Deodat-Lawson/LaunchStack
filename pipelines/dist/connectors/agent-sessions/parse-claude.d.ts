/**
 * Claude Code session parser.
 *
 * A session file is one JSON record per line. Conversation lines (`user` /
 * `assistant`) embed an API-shaped message whose content is either a plain
 * string or an array of typed blocks; everything else is harness bookkeeping.
 * The parser is line-tolerant — a torn trailing line from a live write, or a
 * record type added by next week's CLI, is counted and skipped, never fatal.
 */
import { type NormalizedSession } from "./types.js";
export declare function summarizeToolInput(input: unknown): string;
/** tool_result content is a string or an array of typed blocks. */
export declare function extractToolResultText(content: unknown): string;
/**
 * Slash-command echoes and hook output are injected into the user channel by
 * the harness; they read as bookkeeping, not as something the user said.
 */
export declare function isHarnessUserText(text: string): boolean;
export declare function parseClaudeSession(raw: string): NormalizedSession;
//# sourceMappingURL=parse-claude.d.ts.map