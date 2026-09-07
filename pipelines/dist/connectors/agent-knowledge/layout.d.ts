/**
 * Declarative map of where Claude Code and Codex keep durable knowledge.
 *
 * Both tools store two very different kinds of files under the same roots:
 * knowledge the user authored (instructions, agents, commands, skills,
 * memories, prompts) and machine state (session transcripts, caches, OAuth
 * tokens, sqlite journals). Only the first kind belongs in a knowledge base,
 * so discovery is allowlist-driven: an entry here is the *only* way a file
 * can be picked up. Anything not named below is invisible to the connector.
 */
export type AgentToolId = "claude-code" | "codex";
export type KnowledgeScope = "global" | "project";
export type KnowledgeKind = "instructions" | "agent" | "command" | "skill" | "memory" | "prompt" | "output-style" | "config";
/** One allowlisted location inside a root. */
export interface LayoutEntry {
    /** Path relative to the root. `""` is not allowed — name a file or dir. */
    readonly path: string;
    readonly kind: KnowledgeKind;
    /**
     * `file` matches exactly one path; `dir` walks it; `nested` walks
     * `<path>/<*>/<nested>` — one fixed subdirectory of each immediate child,
     * and nothing else in that child.
     */
    readonly target: "file" | "dir" | "nested";
    /** Required for `nested`: the subdirectory to walk inside each child. */
    readonly nested?: string;
    /** Only meaningful for `dir` — walk nested directories too. */
    readonly recursive?: boolean;
    /**
     * Config files can hold API keys and OAuth material, so they are behind
     * the `includeConfig` option rather than on by default.
     */
    readonly config?: boolean;
}
export interface ToolLayout {
    readonly toolId: AgentToolId;
    readonly label: string;
    /** Directory under the user's home that holds global knowledge. */
    readonly globalRoot: string;
    readonly globalEntries: readonly LayoutEntry[];
    /** Entries resolved against a project directory. */
    readonly projectEntries: readonly LayoutEntry[];
}
export declare const CLAUDE_CODE_LAYOUT: ToolLayout;
export declare const CODEX_LAYOUT: ToolLayout;
export declare const TOOL_LAYOUTS: readonly ToolLayout[];
export declare function layoutFor(toolId: AgentToolId): ToolLayout;
/** Text-ish extensions a knowledge file may carry. */
export declare const KNOWLEDGE_EXTENSIONS: ReadonlySet<string>;
/** Extensions only readable when `includeConfig` is on. */
export declare const CONFIG_EXTENSIONS: ReadonlySet<string>;
/**
 * Names that must never be read, whatever the extension says. These sit
 * inside allowlisted roots, so the allowlist alone would not stop them.
 */
export declare const DENIED_FILENAMES: ReadonlySet<string>;
/** Filename patterns that read as secret material. */
export declare const DENIED_FILENAME_PATTERNS: readonly RegExp[];
/** Directory names never descended into, at any depth. */
export declare const DENIED_DIRECTORIES: ReadonlySet<string>;
export declare function isDeniedFilename(name: string): boolean;
export declare function isDeniedDirectory(name: string): boolean;
//# sourceMappingURL=layout.d.ts.map