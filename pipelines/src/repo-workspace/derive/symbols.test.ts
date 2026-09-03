import { describe, expect, it } from "vitest";

import { extractFileSymbols, supportedLanguageForPath } from "./symbols";

const tsFixture = [
    'import { formatCents } from "./format";',
    "",
    "export interface Invoice {",
    "    lineItems: LineItem[];",
    "}",
    "",
    "export type InvoiceId = string;",
    "",
    "export enum InvoiceStatus {",
    "    Draft,",
    "    Sent,",
    "}",
    "",
    "export const TAX_RATE = 0.19;",
    "let runningTotal = 0;",
    "",
    "export default function summarize(invoice: Invoice): string {",
    "    return formatCents(computeTotal(invoice));",
    "}",
    "",
    "export async function computeTotal(invoice: Invoice): Promise<number> {",
    "    return invoice.lineItems.reduce((total, item) => total + item.amountCents, 0);",
    "}",
    "",
    "export class InvoicePrinter {",
    "    print(invoice: Invoice): void {}",
    "}",
    "",
    "const handlers = {",
    "    onSave: function (invoice: Invoice) {},",
    "};",
].join("\n");

const jsFixture = [
    'const config = require("./config");',
    "",
    "var legacyCounter = 0;",
    "let sessionCache = null;",
    "",
    "function buildReport(rows) {",
    '    return rows.map(renderRow).join("+");',
    "}",
    "",
    "class ReportWriter {}",
    "",
    "module.exports = { buildReport, ReportWriter };",
].join("\n");

const pyFixture = [
    "import os",
    "from collections import defaultdict",
    "",
    "DEFAULT_LIMIT = 25",
    "retry_limit: int = 3",
    "_cache = {}",
    "",
    "def load_entries(path):",
    '    """Read entries from disk."""',
    "    with open(path) as handle:",
    "        return parse_lines(handle.readlines())",
    "",
    "async def refresh_cache():",
    "    global _cache",
    "    _cache = build_index()",
    "",
    "class EntryStore:",
    "    def __init__(self, backend):",
    "        self.backend = backend",
    "",
    "    def lookup(self, key):",
    "        return self.entries.get(key)",
].join("\n");

const goFixture = [
    "package storage",
    "",
    "import (",
    '    "fmt"',
    '    "strings"',
    ")",
    "",
    "const defaultLimit = 25",
    "",
    'var ErrMissing = errors.New("entry missing")',
    "",
    "var (",
    "    registry map[string]Entry",
    "    revision int",
    ")",
    "",
    "type Entry struct {",
    "    Name string",
    "    Size int64",
    "}",
    "",
    "type Store interface {",
    "    Lookup(name string) (Entry, bool)",
    "}",
    "",
    "func NewStore(limit int) *Store {",
    "    return buildStore(limit)",
    "}",
    "",
    "func (s *memoryStore) Lookup(name string) (Entry, bool) {",
    "    fmt.Println(strings.ToUpper(name))",
    "    entry, ok := s.entries[name]",
    "    return entry, ok",
    "}",
].join("\n");

const javaFixture = [
    "package com.acme.billing;",
    "",
    "import java.util.List;",
    "",
    "public class InvoiceService {",
    "    private static final int MAX_RETRIES = 3;",
    "",
    "    public InvoiceService(AuditLog log) {",
    "        this.log = log;",
    "    }",
    "",
    "    public String renderSummary(List<Invoice> invoices) {",
    "        // delegates to the shared summary formatter",
    "        return SummaryFormatter.format(invoices);",
    "    }",
    "",
    "    protected boolean shouldRetry(int attempt) {",
    "        return attempt < MAX_RETRIES;",
    "    }",
    "",
    "    interface Callback {",
    "        void onDone();",
    "    }",
    "",
    "    enum Mode { FAST, SAFE }",
    "}",
].join("\n");

const rustFixture = [
    "use std::collections::HashMap;",
    "",
    "pub struct Ledger {",
    "    accounts: HashMap<String, i64>,",
    "}",
    "",
    "pub enum LedgerError {",
    "    Missing,",
    "    Frozen,",
    "}",
    "",
    "pub trait Balance {",
    "    fn balance(&self) -> i64;",
    "}",
    "",
    "impl Ledger {",
    "    pub fn new_ledger() -> Self {",
    "        build_empty()",
    "    }",
    "",
    "    fn total(&self) -> i64 {",
    "        self.accounts.values().sum()",
    "    }",
    "}",
    "",
    "pub async fn sync_ledger(ledger: &Ledger) -> Result<(), LedgerError> {",
    "    // pushes to the remote_endpoint",
    "    push_remote(ledger).await",
    "}",
].join("\n");

const rubyFixture = [
    'require "json"',
    "",
    "module Billing",
    "  class InvoicePresenter",
    "    def initialize(invoice)",
    "      @invoice = invoice",
    "    end",
    "",
    "    def render_line_items",
    "      # formats the visible_rows",
    "      @invoice.line_items.map { |item| format_row(item) }",
    "    end",
    "",
    "    def self.build_default",
    "      new(Invoice.latest)",
    "    end",
    "  end",
    "end",
].join("\n");

const allFixtures: Array<[string, string]> = [
    ["invoice.ts", tsFixture],
    ["report.js", jsFixture],
    ["store.py", pyFixture],
    ["store.go", goFixture],
    ["InvoiceService.java", javaFixture],
    ["ledger.rs", rustFixture],
    ["presenter.rb", rubyFixture],
];

describe("supportedLanguageForPath", () => {
    it("maps every supported extension to its language id", () => {
        expect(supportedLanguageForPath("src/app.ts")).toBe("typescript");
        expect(supportedLanguageForPath("src/App.tsx")).toBe("typescript");
        expect(supportedLanguageForPath("lib/index.js")).toBe("javascript");
        expect(supportedLanguageForPath("lib/View.jsx")).toBe("javascript");
        expect(supportedLanguageForPath("scripts/run.mjs")).toBe("javascript");
        expect(supportedLanguageForPath("scripts/run.cjs")).toBe("javascript");
        expect(supportedLanguageForPath("tools/sync.py")).toBe("python");
        expect(supportedLanguageForPath("cmd/main.go")).toBe("go");
        expect(supportedLanguageForPath("src/Main.java")).toBe("java");
        expect(supportedLanguageForPath("src/lib.rs")).toBe("rust");
        expect(supportedLanguageForPath("app/models/user.rb")).toBe("ruby");
    });

    it("matches extensions case-insensitively", () => {
        expect(supportedLanguageForPath("SRC/MAIN.TS")).toBe("typescript");
        expect(supportedLanguageForPath("tools/SYNC.Py")).toBe("python");
    });

    it("returns null for unsupported extensions", () => {
        expect(supportedLanguageForPath("styles/site.css")).toBeNull();
        expect(supportedLanguageForPath("README.md")).toBeNull();
        expect(supportedLanguageForPath("data.json")).toBeNull();
    });

    it("returns null for extension-less files and dotfiles", () => {
        expect(supportedLanguageForPath("Makefile")).toBeNull();
        expect(supportedLanguageForPath(".gitignore")).toBeNull();
        expect(supportedLanguageForPath("")).toBeNull();
    });

    it("only considers the basename, not dots in directories", () => {
        expect(supportedLanguageForPath("src.ts/README")).toBeNull();
        expect(supportedLanguageForPath("v1.0/main.go")).toBe("go");
    });
});

describe("TypeScript extraction", () => {
    const result = extractFileSymbols("invoice.ts", tsFixture);

    it("captures the full range of declaration forms, in order", () => {
        expect(result?.definitions).toEqual([
            "Invoice",
            "InvoiceId",
            "InvoiceStatus",
            "TAX_RATE",
            "runningTotal",
            "summarize",
            "computeTotal",
            "InvoicePrinter",
            "handlers",
            "onSave",
        ]);
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("formatCents");
        expect(result?.references).toContain("LineItem");
        expect(result?.references).toContain("amountCents");
        expect(result?.references).toContain("lineItems");
        expect(result?.references).toContain("reduce");
    });

    it("excludes its own definitions, keywords, and built-ins from references", () => {
        expect(result?.references).not.toContain("Invoice");
        expect(result?.references).not.toContain("computeTotal");
        expect(result?.references).not.toContain("summarize");
        expect(result?.references).not.toContain("string");
        expect(result?.references).not.toContain("number");
        expect(result?.references).not.toContain("Promise");
        expect(result?.references).not.toContain("export");
        expect(result?.references).not.toContain("function");
    });

    it("does not surface tokens from import specifier strings", () => {
        // "format" appears only inside the "./format" module string.
        expect(result?.references).not.toContain("format");
    });

    it("treats .tsx the same as .ts", () => {
        expect(extractFileSymbols("invoice.tsx", tsFixture)).toEqual({
            ...result,
            path: "invoice.tsx",
        });
    });
});

describe("JavaScript extraction", () => {
    const result = extractFileSymbols("report.js", jsFixture);

    it("captures functions, classes, and top-level bindings", () => {
        expect(result?.definitions).toEqual([
            "config",
            "legacyCounter",
            "sessionCache",
            "buildReport",
            "ReportWriter",
        ]);
    });

    it("keeps callees as references but drops CommonJS noise", () => {
        expect(result?.references).toContain("renderRow");
        expect(result?.references).toContain("rows");
        expect(result?.references).not.toContain("require");
        expect(result?.references).not.toContain("module");
        expect(result?.references).not.toContain("exports");
        expect(result?.references).not.toContain("buildReport");
    });

    it("handles .mjs and .cjs the same way", () => {
        expect(extractFileSymbols("report.mjs", jsFixture)?.definitions).toEqual(
            result?.definitions
        );
        expect(extractFileSymbols("report.cjs", jsFixture)?.definitions).toEqual(
            result?.definitions
        );
    });
});

describe("Python extraction", () => {
    const result = extractFileSymbols("store.py", pyFixture);

    it("captures defs, classes, and column-zero assignments, in order", () => {
        expect(result?.definitions).toEqual([
            "DEFAULT_LIMIT",
            "retry_limit",
            "_cache",
            "load_entries",
            "refresh_cache",
            "EntryStore",
            "__init__",
            "lookup",
        ]);
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("parse_lines");
        expect(result?.references).toContain("build_index");
        expect(result?.references).toContain("defaultdict");
        expect(result?.references).toContain("backend");
    });

    it("excludes self-definitions, keywords, built-ins, and docstring text", () => {
        expect(result?.references).not.toContain("load_entries");
        expect(result?.references).not.toContain("EntryStore");
        expect(result?.references).not.toContain("self");
        expect(result?.references).not.toContain("open");
        expect(result?.references).not.toContain("global");
        expect(result?.references).not.toContain("disk");
    });

    it("does not treat indented assignments as top-level definitions", () => {
        const nested = extractFileSymbols("n.py", "def outer():\n    inner_value = 1\n");
        expect(nested?.definitions).toEqual(["outer"]);
        expect(nested?.references).toContain("inner_value");
    });
});

describe("Go extraction", () => {
    const result = extractFileSymbols("store.go", goFixture);

    it("captures funcs, methods, types, and var/const including groups", () => {
        expect(result?.definitions).toEqual([
            "defaultLimit",
            "ErrMissing",
            "registry",
            "revision",
            "Entry",
            "Store",
            "NewStore",
            "Lookup",
        ]);
    });

    it("does not capture struct fields inside a type body", () => {
        expect(result?.definitions).not.toContain("Name");
        expect(result?.definitions).not.toContain("Size");
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("buildStore");
        expect(result?.references).toContain("memoryStore");
        expect(result?.references).toContain("ToUpper");
    });

    it("excludes self-definitions, keywords, built-ins, and string contents", () => {
        expect(result?.references).not.toContain("Entry");
        expect(result?.references).not.toContain("Lookup");
        expect(result?.references).not.toContain("fmt");
        expect(result?.references).not.toContain("Println");
        expect(result?.references).not.toContain("missing");
    });
});

describe("Java extraction", () => {
    const result = extractFileSymbols("InvoiceService.java", javaFixture);

    it("captures types and visible methods, deduping the constructor", () => {
        expect(result?.definitions).toEqual([
            "InvoiceService",
            "renderSummary",
            "shouldRetry",
            "Callback",
            "Mode",
        ]);
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("AuditLog");
        expect(result?.references).toContain("SummaryFormatter");
        expect(result?.references).toContain("Invoice");
        expect(result?.references).toContain("invoices");
        expect(result?.references).toContain("MAX_RETRIES");
    });

    it("excludes self-definitions, keywords, built-ins, and comment text", () => {
        expect(result?.references).not.toContain("renderSummary");
        expect(result?.references).not.toContain("String");
        expect(result?.references).not.toContain("List");
        expect(result?.references).not.toContain("delegates");
        expect(result?.references).not.toContain("formatter");
    });
});

describe("Rust extraction", () => {
    const result = extractFileSymbols("ledger.rs", rustFixture);

    it("captures structs, enums, traits, impls, and fns, in order", () => {
        expect(result?.definitions).toEqual([
            "Ledger",
            "LedgerError",
            "Balance",
            "balance",
            "new_ledger",
            "total",
            "sync_ledger",
        ]);
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("build_empty");
        expect(result?.references).toContain("push_remote");
        expect(result?.references).toContain("accounts");
    });

    it("excludes self-definitions, keywords, built-ins, and comment text", () => {
        expect(result?.references).not.toContain("Ledger");
        expect(result?.references).not.toContain("balance");
        expect(result?.references).not.toContain("HashMap");
        expect(result?.references).not.toContain("String");
        expect(result?.references).not.toContain("i64");
        expect(result?.references).not.toContain("remote_endpoint");
    });
});

describe("Ruby extraction", () => {
    const result = extractFileSymbols("presenter.rb", rubyFixture);

    it("captures modules, classes, and defs (including def self.)", () => {
        expect(result?.definitions).toEqual([
            "Billing",
            "InvoicePresenter",
            "initialize",
            "render_line_items",
            "build_default",
        ]);
    });

    it("reports outside identifiers as references", () => {
        expect(result?.references).toContain("invoice");
        expect(result?.references).toContain("line_items");
        expect(result?.references).toContain("format_row");
        expect(result?.references).toContain("Invoice");
        expect(result?.references).toContain("latest");
    });

    it("excludes self-definitions, keywords, built-ins, comments, and strings", () => {
        expect(result?.references).not.toContain("InvoicePresenter");
        expect(result?.references).not.toContain("require");
        expect(result?.references).not.toContain("new");
        expect(result?.references).not.toContain("json");
        expect(result?.references).not.toContain("visible_rows");
    });
});

describe("reference collection", () => {
    it("dedupes references preserving first-occurrence order", () => {
        const content = "zulu();\nalpha();\nzulu();\nbeta();\nalpha();\n";
        const result = extractFileSymbols("order.js", content);
        expect(result?.references).toEqual(["zulu", "alpha", "beta"]);
    });

    it("ignores tokens shorter than three characters", () => {
        const result = extractFileSymbols("short.py", "total = ab + x");
        expect(result?.definitions).toEqual(["total"]);
        expect(result?.references).toEqual([]);
    });

    it("caps references at 200, keeping the earliest tokens", () => {
        const lines = Array.from({ length: 250 }, (_, i) => `print(ref_name_${i})`);
        const result = extractFileSymbols("caps.py", lines.join("\n"));
        expect(result?.references).toHaveLength(200);
        expect(result?.references[0]).toBe("ref_name_0");
        expect(result?.references[199]).toBe("ref_name_199");
        expect(result?.references).not.toContain("ref_name_200");
    });

    it("does not classify number-literal suffixes as identifiers", () => {
        const result = extractFileSymbols("hex.js", "mask(0x1FAB, 0b1010);");
        expect(result?.references).toEqual(["mask"]);
    });
});

describe("definition collection", () => {
    it("dedupes redefinitions preserving first-occurrence order", () => {
        const result = extractFileSymbols(
            "dupes.py",
            "foo = 1\nbar = 2\nfoo = 3\ndef foo():\n    pass\n"
        );
        expect(result?.definitions).toEqual(["foo", "bar"]);
    });

    it("caps definitions at 100, keeping the earliest names", () => {
        const lines = Array.from({ length: 150 }, (_, i) => `value_${i} = ${i}`);
        const result = extractFileSymbols("caps.py", lines.join("\n"));
        expect(result?.definitions).toHaveLength(100);
        expect(result?.definitions[0]).toBe("value_0");
        expect(result?.definitions[99]).toBe("value_99");
        expect(result?.definitions).not.toContain("value_100");
    });

    it("still excludes definitions beyond the cap from references", () => {
        const lines = Array.from({ length: 150 }, (_, i) => `value_${i} = ${i}`);
        const result = extractFileSymbols("caps.py", lines.join("\n"));
        expect(result?.references).toEqual([]);
    });
});

describe("comment and string stripping", () => {
    it("ignores TS line comments, block comments, strings, and templates", () => {
        const content = [
            "// helper: ghostFromComment",
            "const real = 1;",
            "/* multi",
            "   ghostFromBlock */",
            'const msg = "ghostFromString";',
            "const tpl = `ghostFromTemplate`;",
        ].join("\n");
        const result = extractFileSymbols("ghosts.ts", content);
        expect(result?.definitions).toEqual(["real", "msg", "tpl"]);
        expect(result?.references).not.toContain("ghostFromComment");
        expect(result?.references).not.toContain("ghostFromBlock");
        expect(result?.references).not.toContain("ghostFromString");
        expect(result?.references).not.toContain("ghostFromTemplate");
    });

    it("does not treat declarations inside comments as definitions", () => {
        const result = extractFileSymbols(
            "ghosts.ts",
            "// function ghostFn() {}\nconst live = 1;\n"
        );
        expect(result?.definitions).toEqual(["live"]);
    });

    it("ignores Python hash comments and docstrings", () => {
        const content = [
            "# ghost_comment",
            'GREETING = "ghost_string"',
            "def doc():",
            '    """ghost_docstring"""',
            "    return other_value",
        ].join("\n");
        const result = extractFileSymbols("ghosts.py", content);
        expect(result?.references).toContain("other_value");
        expect(result?.references).not.toContain("ghost_comment");
        expect(result?.references).not.toContain("ghost_string");
        expect(result?.references).not.toContain("ghost_docstring");
    });

    it("ignores Go comments and raw backtick strings", () => {
        const content = [
            "package main",
            "",
            "// ghost_go_comment",
            "const query = `select ghost_raw from table_name`",
            'var address = "https://ghost_in_url.example"',
        ].join("\n");
        const result = extractFileSymbols("ghosts.go", content);
        expect(result?.definitions).toEqual(["query", "address"]);
        expect(result?.references).not.toContain("ghost_go_comment");
        expect(result?.references).not.toContain("ghost_raw");
        expect(result?.references).not.toContain("table_name");
        expect(result?.references).not.toContain("ghost_in_url");
    });

    it("ignores Java block comments and string literals", () => {
        const content = [
            "public class Ghosts {",
            "    /* ghost_java_block */",
            '    public String label() { return "ghost_java_string" + suffix; }',
            "}",
        ].join("\n");
        const result = extractFileSymbols("Ghosts.java", content);
        expect(result?.references).toContain("suffix");
        expect(result?.references).not.toContain("ghost_java_block");
        expect(result?.references).not.toContain("ghost_java_string");
    });

    it("ignores Rust comments and string literals", () => {
        const content = [
            "// ghost_rust_comment",
            "pub fn greet() {",
            '    let msg = "ghost_rust_string";',
            "    emit(msg, other_ident);",
            "}",
        ].join("\n");
        const result = extractFileSymbols("ghosts.rs", content);
        expect(result?.references).toContain("other_ident");
        expect(result?.references).not.toContain("ghost_rust_comment");
        expect(result?.references).not.toContain("ghost_rust_string");
    });

    it("ignores Ruby comments and string literals", () => {
        const content = [
            "# ghost_ruby_comment",
            "def greet",
            "  label = 'ghost_ruby_string'",
            "  emit(label, other_ident)",
            "end",
        ].join("\n");
        const result = extractFileSymbols("ghosts.rb", content);
        expect(result?.references).toContain("other_ident");
        expect(result?.references).not.toContain("ghost_ruby_comment");
        expect(result?.references).not.toContain("ghost_ruby_string");
    });

    it("recovers at the line break from an unterminated single-line string", () => {
        const content = ['const broken = "no closing quote', "const after = usable();"].join("\n");
        const result = extractFileSymbols("broken.ts", content);
        expect(result?.definitions).toEqual(["broken", "after"]);
        expect(result?.references).toContain("usable");
    });
});

describe("robustness", () => {
    it("returns empty arrays (not null) for an empty supported file", () => {
        expect(extractFileSymbols("empty.ts", "")).toEqual({
            path: "empty.ts",
            definitions: [],
            references: [],
        });
    });

    it("returns empty arrays for whitespace-only content", () => {
        expect(extractFileSymbols("blank.py", "   \n\t\n  ")).toEqual({
            path: "blank.py",
            definitions: [],
            references: [],
        });
    });

    it("returns null for unsupported files regardless of content", () => {
        expect(extractFileSymbols("styles.css", "body { color: red }")).toBeNull();
        expect(extractFileSymbols("notes.txt", "function looksLikeCode() {}")).toBeNull();
        expect(extractFileSymbols("Dockerfile", "FROM node:20")).toBeNull();
    });

    it("handles CRLF line endings in TypeScript", () => {
        const content = [
            "export function crlfHandler(x: number) {",
            "    return otherThing(x);",
            "}",
            "const CRLF_LIMIT = 10;",
        ].join("\r\n");
        const result = extractFileSymbols("crlf.ts", content);
        expect(result?.definitions).toEqual(["crlfHandler", "CRLF_LIMIT"]);
        expect(result?.references).toContain("otherThing");
    });

    it("handles CRLF column-zero assignments in Python", () => {
        const result = extractFileSymbols("crlf.py", "TOP_LEVEL = 1\r\nother_value = 2\r\n");
        expect(result?.definitions).toEqual(["TOP_LEVEL", "other_value"]);
    });

    it("skips single lines longer than 5000 characters", () => {
        const longLine = `const minifiedTarget = ${"1 + ".repeat(2000)}1;`;
        expect(longLine.length).toBeGreaterThan(5000);
        const content = ["const keptName = readValue();", longLine, "const tailName = 2;"].join(
            "\n"
        );
        const result = extractFileSymbols("minified.js", content);
        expect(result?.definitions).toEqual(["keptName", "tailName"]);
        expect(result?.definitions).not.toContain("minifiedTarget");
        expect(result?.references).toContain("readValue");
    });

    it("still scans a line of exactly 5000 characters", () => {
        const boundaryLine = "const boundaryName = 1;".padEnd(5000, " ");
        expect(boundaryLine).toHaveLength(5000);
        const result = extractFileSymbols("boundary.js", boundaryLine);
        expect(result?.definitions).toEqual(["boundaryName"]);

        const overLine = "const overName = 1;".padEnd(5001, " ");
        const over = extractFileSymbols("boundary.js", overLine);
        expect(over?.definitions).toEqual([]);
    });
});

describe("determinism", () => {
    it("produces deep-equal output for repeated runs on every fixture", () => {
        for (const [path, content] of allFixtures) {
            const first = extractFileSymbols(path, content);
            const second = extractFileSymbols(path, content);
            expect(second).toEqual(first);
            expect(first).not.toBeNull();
        }
    });
});
