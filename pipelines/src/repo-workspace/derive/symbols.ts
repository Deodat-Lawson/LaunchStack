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

import type { FileSymbols, SymbolExtractor } from "../types";

export type SupportedLanguage =
    | "typescript"
    | "javascript"
    | "python"
    | "go"
    | "java"
    | "rust"
    | "ruby";

const MAX_DEFINITIONS = 100;
const MAX_REFERENCES = 200;
/** Lines longer than this (minified bundles, generated code) are skipped. */
const MAX_SCANNED_LINE_LENGTH = 5000;

/** Word tokens of at least three characters, spec'd in the derive design. */
const TOKEN_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;

const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    java: "java",
    rs: "rust",
    rb: "ruby",
};

/** Language id for a repo-relative path, or `null` when unsupported. */
export function supportedLanguageForPath(path: string): SupportedLanguage | null {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    if (dot <= 0) {
        return null;
    }
    const extension = base.slice(dot + 1).toLowerCase();
    return EXTENSION_TO_LANGUAGE[extension] ?? null;
}

// ---------------------------------------------------------------------------
// Comment/string stripping
// ---------------------------------------------------------------------------

interface CommentStringSyntax {
    readonly lineComments: readonly string[];
    readonly blockComments: readonly (readonly [string, string])[];
    /** Longest delimiters first so `"""` wins over `"`. */
    readonly stringDelimiters: readonly string[];
    /** Single-character delimiters that may still span lines (JS/Go backtick). */
    readonly multilineStringDelimiters?: ReadonlySet<string>;
    /** Delimiters whose strings take no backslash escapes (Go raw strings). */
    readonly rawStringDelimiters?: ReadonlySet<string>;
}

function blankChar(char: string): string {
    return char === "\n" ? "\n" : " ";
}

/**
 * Blank comments and string contents with spaces, preserving newlines and the
 * string delimiters themselves so the line-anchored definition patterns keep
 * seeing the surrounding structure. Deterministic best effort — see the
 * module header for what it deliberately does not understand.
 */
function stripCommentsAndStrings(source: string, syntax: CommentStringSyntax): string {
    const out: string[] = [];
    const length = source.length;
    let i = 0;
    scan: while (i < length) {
        for (const marker of syntax.lineComments) {
            if (source.startsWith(marker, i)) {
                while (i < length && source.charAt(i) !== "\n") {
                    out.push(" ");
                    i += 1;
                }
                continue scan;
            }
        }
        for (const [open, close] of syntax.blockComments) {
            if (source.startsWith(open, i)) {
                out.push(" ".repeat(open.length));
                i += open.length;
                while (i < length && !source.startsWith(close, i)) {
                    out.push(blankChar(source.charAt(i)));
                    i += 1;
                }
                if (i < length) {
                    out.push(" ".repeat(close.length));
                    i += close.length;
                }
                continue scan;
            }
        }
        for (const delimiter of syntax.stringDelimiters) {
            if (source.startsWith(delimiter, i)) {
                out.push(delimiter);
                i += delimiter.length;
                const multiline =
                    delimiter.length > 1 ||
                    syntax.multilineStringDelimiters?.has(delimiter) === true;
                const escapes = syntax.rawStringDelimiters?.has(delimiter) !== true;
                while (i < length) {
                    const char = source.charAt(i);
                    if (escapes && char === "\\" && i + 1 < length) {
                        out.push(" ", blankChar(source.charAt(i + 1)));
                        i += 2;
                        continue;
                    }
                    if (source.startsWith(delimiter, i)) {
                        out.push(delimiter);
                        i += delimiter.length;
                        break;
                    }
                    if (!multiline && char === "\n") {
                        // Unterminated single-line string: stop at the line
                        // break instead of swallowing the rest of the file.
                        out.push("\n");
                        i += 1;
                        break;
                    }
                    out.push(blankChar(char));
                    i += 1;
                }
                continue scan;
            }
        }
        out.push(source.charAt(i));
        i += 1;
    }
    return out.join("");
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

interface DefinitionRules {
    /** Anchored, once-per-line patterns; capture group 1 is the name. */
    readonly linePatterns: readonly RegExp[];
    /** Global patterns that may match several times on one line. */
    readonly inlinePatterns?: readonly RegExp[];
    /** Go-style grouped `var ( … )` / `const ( … )` / `type ( … )` blocks. */
    readonly groupedDeclarations?: boolean;
}

const GROUP_OPEN_PATTERN = /^(?:var|const|type)\s*\(\s*$/;
const GROUP_CLOSE_PATTERN = /^\s*\)/;
const GROUP_MEMBER_PATTERN = /^\s*([A-Za-z_]\w*)/;

function countChar(line: string, target: string): number {
    let count = 0;
    for (const char of line) {
        if (char === target) {
            count += 1;
        }
    }
    return count;
}

/** All names the file defines, deduped in first-occurrence order, uncapped. */
function collectDefinitions(lines: readonly string[], rules: DefinitionRules): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const add = (name: string | undefined): void => {
        if (name !== undefined && name.length > 0 && !seen.has(name)) {
            seen.add(name);
            ordered.push(name);
        }
    };
    let inGroup = false;
    let groupBraceDepth = 0;
    for (const line of lines) {
        if (rules.groupedDeclarations === true) {
            if (inGroup) {
                if (groupBraceDepth === 0 && GROUP_CLOSE_PATTERN.test(line)) {
                    inGroup = false;
                    continue;
                }
                if (groupBraceDepth === 0) {
                    add(GROUP_MEMBER_PATTERN.exec(line)?.[1]);
                }
                groupBraceDepth += countChar(line, "{") - countChar(line, "}");
                if (groupBraceDepth < 0) {
                    groupBraceDepth = 0;
                }
                continue;
            }
            if (GROUP_OPEN_PATTERN.test(line)) {
                inGroup = true;
                groupBraceDepth = 0;
                continue;
            }
        }
        for (const pattern of rules.linePatterns) {
            add(pattern.exec(line)?.[1]);
        }
        for (const pattern of rules.inlinePatterns ?? []) {
            for (const match of line.matchAll(pattern)) {
                add(match[1]);
            }
        }
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

function collectReferences(
    stripped: string,
    definitions: ReadonlySet<string>,
    stopwords: ReadonlySet<string>
): string[] {
    const seen = new Set<string>();
    const references: string[] = [];
    for (const match of stripped.matchAll(TOKEN_PATTERN)) {
        const token = match[0];
        if (stopwords.has(token) || definitions.has(token) || seen.has(token)) {
            continue;
        }
        seen.add(token);
        references.push(token);
        if (references.length >= MAX_REFERENCES) {
            break;
        }
    }
    return references;
}

// ---------------------------------------------------------------------------
// Language profiles
// ---------------------------------------------------------------------------

interface LanguageProfile {
    readonly syntax: CommentStringSyntax;
    readonly definitions: DefinitionRules;
    /** Keywords plus common built-ins — never reported as references. */
    readonly stopwords: ReadonlySet<string>;
}

function words(list: string): ReadonlySet<string> {
    return new Set(list.split(/\s+/).filter(word => word.length > 0));
}

const C_FAMILY_COMMENTS = {
    lineComments: ["//"],
    blockComments: [["/*", "*/"] as const],
} as const;

const TS_JS_PROFILE: LanguageProfile = {
    syntax: {
        ...C_FAMILY_COMMENTS,
        stringDelimiters: ["`", '"', "'"],
        multilineStringDelimiters: new Set(["`"]),
    },
    definitions: {
        linePatterns: [
            /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_]\w*)/,
            /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_]\w*)/,
            /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_]\w*)/,
            /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_]\w*)[^=\n]*=/,
            /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_]\w*)/,
            /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)(?:\s*:[^=\n]+)?\s*=(?!=)/,
        ],
        inlinePatterns: [/\b([A-Za-z_]\w*)\s*:\s*(?:async\s+)?function\b/g],
    },
    stopwords: words(`
        abstract any arguments as asserts async await bigint boolean break case
        catch class const constructor continue debugger declare default delete
        do else enum export extends false finally for from function get global
        if implements import in infer instanceof interface is keyof let module
        namespace never new null number object of out override package private
        protected prototype public readonly require return satisfies set static
        string super switch symbol this throw true try type typeof undefined
        unique unknown var void while with yield
        console process window document globalThis exports Promise Array Object
        String Number Boolean Math JSON Error TypeError RangeError SyntaxError
        Map Set WeakMap WeakSet Symbol Date RegExp Function Infinity NaN
        parseInt parseFloat isNaN isFinite structuredClone Buffer setTimeout
        setInterval clearTimeout clearInterval queueMicrotask fetch Request
        Response Headers URL URLSearchParams TextEncoder TextDecoder
        AbortController Record Partial Readonly Pick Omit Exclude Extract
        Awaited ReturnType InstanceType NonNullable Parameters Required
    `),
};

const PYTHON_PROFILE: LanguageProfile = {
    syntax: {
        lineComments: ["#"],
        blockComments: [],
        stringDelimiters: ['"""', "'''", '"', "'"],
    },
    definitions: {
        linePatterns: [
            /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
            /^\s*class\s+([A-Za-z_]\w*)/,
            /^([A-Za-z_]\w*)(?:\s*:[^=\n]+)?\s*=(?!=)/,
        ],
    },
    stopwords: words(`
        False None True and as assert async await break case class continue def
        del elif else except finally for from global if import in is lambda
        match nonlocal not or pass raise return try while with yield
        self cls print len range str int float complex bool list dict set tuple
        frozenset bytes bytearray object type super isinstance issubclass
        hasattr getattr setattr delattr callable enumerate zip map filter
        sorted reversed sum min max abs round divmod open input repr hash iter
        next vars dir staticmethod classmethod property format any all
        Exception BaseException ValueError TypeError KeyError IndexError
        AttributeError RuntimeError StopIteration NotImplementedError OSError
        IOError __init__ __name__ __main__ __repr__ __str__ __eq__ __ne__
        __hash__ __len__ __iter__ __next__ __enter__ __exit__ __call__ __doc__
        __file__ __all__ __slots__ __dict__
    `),
};

const GO_PROFILE: LanguageProfile = {
    syntax: {
        ...C_FAMILY_COMMENTS,
        stringDelimiters: ['"', "'", "`"],
        multilineStringDelimiters: new Set(["`"]),
        rawStringDelimiters: new Set(["`"]),
    },
    definitions: {
        linePatterns: [
            /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
            /^type\s+([A-Za-z_]\w*)/,
            /^(?:var|const)\s+([A-Za-z_]\w*)/,
        ],
        groupedDeclarations: true,
    },
    stopwords: words(`
        break case chan const continue default defer else fallthrough for func
        go goto if import interface map package range return select struct
        switch type var
        append cap close copy delete len make new panic print println recover
        complex real imag min max clear error string bool byte rune int int8
        int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32
        float64 complex64 complex128 nil true false iota any comparable err ctx
        fmt Println Printf Sprintf Fprintf Errorf Sprint Fprintln context
        Context
    `),
};

const JAVA_PROFILE: LanguageProfile = {
    syntax: {
        ...C_FAMILY_COMMENTS,
        stringDelimiters: ['"""', '"', "'"],
    },
    definitions: {
        linePatterns: [/^\s*(?:public|protected|private)\b[^=;{}]*?\b([A-Za-z_]\w*)\s*\(/],
        inlinePatterns: [/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g],
    },
    stopwords: words(`
        abstract assert boolean break byte case catch char class const continue
        default do double else enum extends final finally float for goto if
        implements import instanceof int interface long native new package
        permits private protected public record return sealed short static
        strictfp super switch synchronized this throw throws transient try var
        void volatile while yield
        true false null String System Object Integer Long Short Byte Double
        Float Boolean Character CharSequence StringBuilder StringBuffer Number
        List ArrayList LinkedList Map HashMap LinkedHashMap TreeMap Set HashSet
        LinkedHashSet TreeSet Collection Collections Arrays Objects Optional
        Stream Collectors Iterable Iterator Comparable Comparator Runnable
        Callable Thread Math Override Deprecated SuppressWarnings
        FunctionalInterface SafeVarargs Exception RuntimeException
        IllegalArgumentException IllegalStateException NullPointerException
        UnsupportedOperationException Throwable Error out err println print
        printf format valueOf toString equals hashCode length size args java
        util lang
    `),
};

const RUST_PROFILE: LanguageProfile = {
    syntax: {
        ...C_FAMILY_COMMENTS,
        stringDelimiters: ['"'],
    },
    definitions: {
        linePatterns: [
            /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/,
            /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/,
            /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/,
            /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/,
            /^\s*(?:unsafe\s+)?impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)/,
        ],
    },
    stopwords: words(`
        as async await break const continue crate dyn else enum extern false fn
        for if impl in let loop macro match mod move mut pub ref return self
        Self static struct super trait true type union unsafe use where while
        String ToString Vec VecDeque Option Some None Result Ok Err Box Rc Arc
        Cell RefCell Mutex RwLock Cow HashMap HashSet BTreeMap BTreeSet
        PhantomData println print eprintln eprint format write writeln panic
        assert matches todo unimplemented unreachable dbg vec std core alloc
        bool char str i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize f32
        f64 clone new default from into iter next collect unwrap expect map
        and_then as_ref as_mut len push get insert remove contains Send Sync
        Sized Unpin Copy Clone Debug Display Default PartialEq Eq PartialOrd
        Ord Hash Iterator IntoIterator From Into TryFrom TryInto AsRef AsMut
        Deref DerefMut Drop Fn FnMut FnOnce
    `),
};

const RUBY_PROFILE: LanguageProfile = {
    syntax: {
        lineComments: ["#"],
        blockComments: [],
        stringDelimiters: ['"', "'"],
    },
    definitions: {
        linePatterns: [
            /^\s*def\s+(?:self\.)?([A-Za-z_]\w*)/,
            /^\s*class\s+(?:[A-Z]\w*::)*([A-Z]\w*)/,
            /^\s*module\s+(?:[A-Z]\w*::)*([A-Z]\w*)/,
        ],
    },
    stopwords: words(`
        BEGIN END alias and begin break case class def defined do else elsif
        end ensure false for if in module next nil not or redo rescue retry
        return self super then true undef unless until when while yield
        require require_relative puts print pp gets loop raise new
        attr_accessor attr_reader attr_writer initialize private public
        protected module_function include extend prepend refine freeze frozen
        lambda proc call each map select reject collect detect inject reduce
        times send public_send respond_to method_missing instance_variable_get
        instance_variable_set define_method block_given
        Array Hash String Integer Float Numeric Symbol Range Proc Struct Kernel
        Object BasicObject Class Module Comparable Enumerable Enumerator
        StandardError ArgumentError RuntimeError TypeError NameError
        NoMethodError NotImplementedError
    `),
};

const LANGUAGE_PROFILES: Record<SupportedLanguage, LanguageProfile> = {
    typescript: TS_JS_PROFILE,
    javascript: TS_JS_PROFILE,
    python: PYTHON_PROFILE,
    go: GO_PROFILE,
    java: JAVA_PROFILE,
    rust: RUST_PROFILE,
    ruby: RUBY_PROFILE,
};

// ---------------------------------------------------------------------------
// The extractor
// ---------------------------------------------------------------------------

/**
 * The default `SymbolExtractor`. Returns `null` for unsupported languages;
 * empty (but non-null) symbol lists for supported files with no matches.
 */
export const extractFileSymbols: SymbolExtractor = (path, content): FileSymbols | null => {
    const language = supportedLanguageForPath(path);
    if (language === null) {
        return null;
    }
    const profile = LANGUAGE_PROFILES[language];
    const lines = content
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(line => (line.length > MAX_SCANNED_LINE_LENGTH ? "" : line));
    const stripped = stripCommentsAndStrings(lines.join("\n"), profile.syntax);
    const allDefinitions = collectDefinitions(stripped.split("\n"), profile.definitions);
    const definitionSet = new Set(allDefinitions);
    return {
        path,
        definitions: allDefinitions.slice(0, MAX_DEFINITIONS),
        references: collectReferences(stripped, definitionSet, profile.stopwords),
    };
};
