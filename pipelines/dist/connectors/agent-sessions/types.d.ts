/**
 * Shared vocabulary for the agent-sessions connector.
 *
 * A session transcript is parsed into a `NormalizedSession` — a flat list of
 * transcript segments plus the metadata worth keeping — regardless of which
 * tool wrote it. Rendering (render.ts) is the only consumer of this shape, so
 * both parsers can stay honest about what they dropped without agreeing on
 * anything but this file.
 */
export declare const SESSION_TOOLS: readonly ["claude-code", "codex"];
export type SessionToolId = (typeof SESSION_TOOLS)[number];
export declare function sessionToolLabel(toolId: SessionToolId): string;
/** Tool inputs are summarized to one line; anything longer is noise. */
export declare const TOOL_INPUT_MAX_CHARS = 200;
/**
 * Tool outputs are kept only up to this cap. It is what keeps a 45 MB session
 * file rendering to a few hundred KB of transcript: error messages and command
 * output stay searchable, but nobody embeds a full build log.
 */
export declare const TOOL_RESULT_MAX_CHARS = 1000;
export type TranscriptSegment = {
    readonly kind: "user";
    readonly text: string;
    readonly at?: string;
} | {
    readonly kind: "assistant";
    readonly text: string;
    readonly at?: string;
} | {
    readonly kind: "tool-call";
    readonly name: string;
    readonly summary: string;
} | {
    readonly kind: "tool-result";
    readonly text: string;
};
/** What the parser declined to carry into the transcript, by category. */
export interface DroppedCounts {
    /** thinking / reasoning blocks — internal monologue, never imported. */
    readonly thinking: number;
    /** Claude Code subagent sidechains. */
    readonly sidechain: number;
    /** Harness bookkeeping (titles, queue ops, token counts, attachments…). */
    readonly metadata: number;
    /** Line or block types this parser does not recognize — the drift signal. */
    readonly unknown: number;
    /** Lines that failed to parse as JSON (torn trailing line included). */
    readonly malformed: number;
}
export interface NormalizedSession {
    readonly tool: SessionToolId;
    /** The tool's own session id; falls back to the filename-derived id. */
    readonly sessionId: string | null;
    /** User-visible title, when the tool recorded one. */
    readonly title: string | null;
    readonly projectPath: string | null;
    readonly gitBranch: string | null;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly segments: readonly TranscriptSegment[];
    readonly dropped: DroppedCounts;
}
export declare function truncateText(text: string, maxChars: number): string;
//# sourceMappingURL=types.d.ts.map