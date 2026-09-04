/**
 * Lightweight symbol extraction — the default `SymbolExtractor` behind the
 * repo-workspace symbol port (`../types`).
 *
 * This is a documented stand-in, not a parser: deterministic, dependency-free
 * regex/line heuristics. It exists so the ranked repo map works out of the
 * box; a tree-sitter-backed extractor can replace it behind the same
 * `SymbolExtractor` port without touching the graph or the map (design §2.3).
 *
 * Known limits, accepted for a ranked-map heuristic:
 * - The comment/string stripper is a single-pass scanner, not a lexer. It does
 *   not understand JS regex literals, Rust nested block comments or lifetime
 *   ticks (`'a` — single quotes are simply not treated as strings in Rust),
 *   Ruby `=begin` blocks or heredocs, or Go raw strings whose last character
 *   is a backslash. Stripped regions are blanked with spaces (newlines kept)
 *   so line and column structure survives for the definition patterns.
 * - Definitions are line-anchored: multi-line declarations, destructuring
 *   bindings, enum members, Java fields and package-private methods, and Go
 *   struct fields are not captured. `impl Trait for Type` captures the trait.
 * - "Top level" for const/var/assignment bindings means column zero.
 * - Identifiers inside JS template-literal interpolations are stripped along
 *   with the rest of the literal.
 */
import type { SymbolExtractor } from "../types.js";
export type SupportedLanguage = "typescript" | "javascript" | "python" | "go" | "java" | "rust" | "ruby";
/** Language id for a repo-relative path, or `null` when unsupported. */
export declare function supportedLanguageForPath(path: string): SupportedLanguage | null;
/**
 * The default `SymbolExtractor`. Returns `null` for unsupported languages;
 * empty (but non-null) symbol lists for supported files with no matches.
 */
export declare const extractFileSymbols: SymbolExtractor;
//# sourceMappingURL=symbols.d.ts.map