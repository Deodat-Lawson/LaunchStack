/**
 * Shared vocabulary for the agent-sessions connector.
 *
 * A session transcript is parsed into a `NormalizedSession` — a flat list of
 * transcript segments plus the metadata worth keeping — regardless of which
 * tool wrote it. Rendering (render.ts) is the only consumer of this shape, so
 * both parsers can stay honest about what they dropped without agreeing on
 * anything but this file.
 */
export const SESSION_TOOLS = ["claude-code", "codex"];
export function sessionToolLabel(toolId) {
    return toolId === "claude-code" ? "Claude Code" : "Codex";
}
/** Tool inputs are summarized to one line; anything longer is noise. */
export const TOOL_INPUT_MAX_CHARS = 200;
/**
 * Tool outputs are kept only up to this cap. It is what keeps a 45 MB session
 * file rendering to a few hundred KB of transcript: error messages and command
 * output stay searchable, but nobody embeds a full build log.
 */
export const TOOL_RESULT_MAX_CHARS = 1000;
export function truncateText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}… [+${text.length - maxChars} chars]`;
}
//# sourceMappingURL=types.js.map