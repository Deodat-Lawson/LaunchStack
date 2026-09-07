/**
 * Bounded metadata peek for the sessions browser.
 *
 * A browsable session list needs real titles and first-prompt previews for
 * hundreds of sessions, and a full parse of hundreds of megabytes is the wrong
 * price for that. The facts the list needs live in predictable places — both
 * dialects put `cwd` on the earliest records, Claude Code appends its title
 * records near the end of the file — so a bounded read of the head and tail of
 * each file recovers them. A peek is best-effort by contract: any miss (torn
 * lines, unreadable file, format drift) degrades to nulls, never to an error.
 */
import type { DiscoveredKnowledgeItem } from "../types.js";
import type { SessionToolId } from "./types.js";
/** Head and tail window. Together at most 128 KiB of a file is read. */
export declare const PEEK_WINDOW_BYTES: number;
export interface SessionPeek {
    readonly title: string | null;
    /** First line of the first real user prompt. */
    readonly preview: string | null;
    readonly projectPath: string | null;
    readonly gitBranch: string | null;
}
/** Peek one session file. Never throws. */
export declare function peekSessionFile(absolutePath: string, tool: SessionToolId): Promise<SessionPeek>;
/** Peek many discovered sessions with bounded concurrency, keyed by sourceId. */
export declare function peekSessions(items: readonly DiscoveredKnowledgeItem[], options?: {
    readonly concurrency?: number;
}): Promise<Map<string, SessionPeek>>;
//# sourceMappingURL=peek.d.ts.map