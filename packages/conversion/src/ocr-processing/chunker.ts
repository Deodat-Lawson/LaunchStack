import type { PageContent, DocumentChunk, ExtractedTable, VectorizedChunk } from "./types";
import type { ChunkMetadata } from "./types";
import { buildDocumentTree, joinPages, renderSubtree, type DocumentNode } from "../document-tree";
import { estimateCounter, type TokenCounter } from "./tokenizer";
import { getOpenAIClient } from "@launchstack/llm";
import { GEMINI_FAST_MODEL } from "@launchstack/llm/types";

/**
 * Chunking.
 *
 * A chunk is a node in the document's tree, not a slice of a string. The
 * pipeline builds one tree for the whole document (`../document-tree`), and
 * this module walks it: a subtree that fits the budget becomes one chunk; a
 * subtree that does not is entered, and its children become chunks that name
 * it as an ancestor. Small neighbours sharing a parent are merged. That is
 * the shape Docling's hierarchical/hybrid chunkers arrived at, and it is what
 * lets a chunk cut out of a large document still say where it came from.
 *
 * Two properties are worth stating because the previous implementation had
 * neither:
 *
 * - **Context is stored, not just embedded.** The ancestor breadcrumb is
 *   written into the chunk's own text, so the lexical index, the reranker,
 *   the answering model and the citation all read what the embedder read.
 *   Previously the breadcrumb existed only inside `prepareForEmbedding` and
 *   was discarded before storage, which meant BM25 could not match on it.
 * - **Budgets are tokens.** A `TokenCounter` decides what fits; the
 *   chars-per-token estimate is a labelled fallback rather than the
 *   mechanism.
 */

function getOpenAI() {
    return getOpenAIClient();
}

export interface ChunkingConfig {
    parentMaxTokens?: number;
    childMaxTokens?: number;
    overlapTokens?: number;
    charsPerToken?: number;
    includePageContext?: boolean;
    /** Written into every chunk's breadcrumb, so a chunk names its document. */
    documentTitle?: string;
    /** Budget arithmetic. Defaults to the chars-per-token estimate. */
    tokens?: TokenCounter;
}

const DEFAULT_CONFIG: Required<Omit<ChunkingConfig, "documentTitle" | "tokens">> = {
    parentMaxTokens: 1000,
    childMaxTokens: 256,
    overlapTokens: 50,
    charsPerToken: 4,
    includePageContext: true,
};

interface ResolvedConfig extends Required<Omit<ChunkingConfig, "documentTitle" | "tokens">> {
    documentTitle?: string;
    tokens: TokenCounter;
}

function resolveConfig(config?: ChunkingConfig): ResolvedConfig {
    const merged = { ...DEFAULT_CONFIG, ...config };
    return {
        ...merged,
        documentTitle: config?.documentTitle,
        tokens: config?.tokens ?? estimateCounter(merged.charsPerToken),
    };
}

// ---------------------------------------------------------------------------
// Contextualisation
// ---------------------------------------------------------------------------

/** The separator between breadcrumb steps. Not `>`; that is Markdown quoting. */
const CRUMB = " › ";

/**
 * The breadcrumb for a chunk: document title, then each enclosing heading or
 * list item. A step already on the path is dropped rather than repeated — an
 * outline whose root topic restates the document's title under every branch
 * would otherwise read "Plan › Billing › Plan".
 */
export function contextHeader(metadata: ChunkMetadata): string | null {
    const parts: string[] = [];
    const seen = new Set<string>();
    const push = (value?: string) => {
        const trimmed = value?.replace(/\s+/g, " ").trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        parts.push(trimmed);
    };
    push(metadata.documentTitle);
    for (const ancestor of metadata.ancestors ?? []) push(ancestor);
    if (parts.length === 0) return null;
    return parts.join(CRUMB);
}

/**
 * The text that is stored, embedded, ranked and quoted — one representation,
 * so those four can never disagree.
 */
export function contextualize(content: string, metadata: ChunkMetadata): string {
    const header = contextHeader(metadata);
    if (!header) return content;
    return `${header}\n\n${content}`;
}

/** Drop the breadcrumb a chunk was stored with, leaving the body. */
export function stripContextHeader(content: string, metadata?: ChunkMetadata): string {
    const header = metadata?.contextHeader;
    if (header && content.startsWith(`${header}\n\n`)) {
        return content.slice(header.length + 2);
    }
    return stripStoredContextHeader(content);
}

/**
 * The same, for a chunk read back from the database, where the metadata that
 * described the header did not travel with it.
 *
 * Anything that needs to match a chunk against the *source document* — a
 * citation quote, a highlight deep-link — has to drop the breadcrumb first,
 * because the breadcrumb is something the index added and the document never
 * contained. The shape is narrow on purpose: one line containing the
 * separator, then a blank line. A body that happens to open with a line of
 * prose is left alone.
 */
export function stripStoredContextHeader(content: string): string {
    const breakAt = content.indexOf("\n\n");
    if (breakAt <= 0) return content;
    const firstLine = content.slice(0, breakAt);
    if (!firstLine.includes(CRUMB)) return content;
    // A breadcrumb is a short path, never a paragraph.
    if (firstLine.length > 300 || firstLine.includes("\n")) return content;
    return content.slice(breakAt + 2);
}

// ---------------------------------------------------------------------------
// Tree → units
// ---------------------------------------------------------------------------

/** A leaf of the walk: text that will go into a chunk, with where it came from. */
interface Unit {
    text: string;
    ancestors: string[];
    page: number;
}

/**
 * Walk the tree into units.
 *
 * A subtree that fits inside one chunk is emitted whole, so a branch and its
 * leaves stay together — the property an outline needs and the one a
 * size-based splitter cannot promise. A subtree that does not fit is entered,
 * and its children are emitted with it named as an ancestor, so nothing loses
 * its context by being too large.
 */
function collectUnits(
    parent: DocumentNode,
    ancestors: string[],
    budgetTokens: number,
    tokens: TokenCounter,
    out: Unit[]
): void {
    for (const child of parent.children) {
        // A heading is a label, not content: it becomes part of the path and
        // its own line is dropped, since the breadcrumb already carries it.
        if (child.kind === "heading") {
            collectUnits(child, [...ancestors, child.text], budgetTokens, tokens, out);
            continue;
        }

        if (child.children.length === 0) {
            const text = child.raw.trim();
            if (text.length > 0) out.push({ text, ancestors, page: child.page });
            continue;
        }

        const whole = renderSubtree(child);
        if (tokens.count(whole) <= budgetTokens) {
            out.push({ text: whole, ancestors, page: child.page });
            continue;
        }

        // Too large to keep whole: enter it. The node's own label survives as
        // an ancestor of everything inside, so no words are lost.
        collectUnits(child, [...ancestors, child.text], budgetTokens, tokens, out);
    }
}

/** Consecutive units sharing an ancestor path — the merge-peers grouping. */
interface Section {
    ancestors: string[];
    page: number;
    units: Unit[];
}

function groupIntoSections(units: Unit[]): Section[] {
    const sections: Section[] = [];
    for (const unit of units) {
        const key = unit.ancestors.join(CRUMB);
        const open = sections[sections.length - 1];
        if (open && open.ancestors.join(CRUMB) === key) {
            open.units.push(unit);
            continue;
        }
        sections.push({ ancestors: unit.ancestors, page: unit.page, units: [unit] });
    }
    return sections;
}

/**
 * Pack units into pieces up to `budgetTokens`, merging neighbours and
 * splitting only a unit that exceeds the budget on its own.
 */
function packUnits(
    units: Unit[],
    budgetTokens: number,
    overlapTokens: number,
    config: ResolvedConfig
): string[] {
    const { tokens } = config;
    const pieces: string[] = [];
    let open: string[] = [];
    let openTokens = 0;

    const flush = () => {
        if (open.length === 0) return;
        pieces.push(open.join("\n"));
        open = [];
        openTokens = 0;
    };

    for (const unit of units) {
        const unitTokens = tokens.count(unit.text);

        if (unitTokens > budgetTokens) {
            flush();
            // One unit larger than a whole chunk: fall back to size-based
            // splitting, which is line-aware so an outline row is never cut.
            const overlapChars = overlapTokens * config.charsPerToken;
            const maxChars = budgetTokens * config.charsPerToken;
            for (const piece of splitWithOverlap(
                unit.text,
                maxChars,
                overlapChars,
                tokens,
                budgetTokens
            ))
                pieces.push(piece);
            continue;
        }

        if (openTokens + unitTokens > budgetTokens) flush();
        open.push(unit.text);
        openTokens += unitTokens;
    }
    flush();
    return pieces;
}

/** Group already-sized pieces into parents up to the parent budget. */
function packPieces(pieces: string[], budgetTokens: number, tokens: TokenCounter): string[][] {
    const groups: string[][] = [];
    let open: string[] = [];
    let openTokens = 0;

    for (const piece of pieces) {
        const pieceTokens = tokens.count(piece);
        if (open.length > 0 && openTokens + pieceTokens > budgetTokens) {
            groups.push(open);
            open = [];
            openTokens = 0;
        }
        open.push(piece);
        openTokens += pieceTokens;
    }
    if (open.length > 0) groups.push(open);
    return groups;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function chunkDocument(
    pages: PageContent[],
    config?: ChunkingConfig
): Promise<DocumentChunk[]> {
    const cfg = resolveConfig(config);
    const chunks: DocumentChunk[] = [];

    // One tree for the whole document. Pages bound the page *numbers*, never
    // the parse — which is what stops a heading stack resetting mid-document.
    const { text, pageStarts } = joinPages(pages);
    const tree = buildDocumentTree(text, pageStarts);

    const units: Unit[] = [];
    collectUnits(tree.root, [], cfg.childMaxTokens, cfg.tokens, units);

    for (const section of groupIntoSections(units)) {
        const childPieces = packUnits(section.units, cfg.childMaxTokens, cfg.overlapTokens, cfg);
        for (const group of packPieces(childPieces, cfg.parentMaxTokens, cfg.tokens)) {
            const children: DocumentChunk[] = group.map((childContent, index) => {
                const metadata: ChunkMetadata = {
                    pageNumber: section.page,
                    chunkIndex: index,
                    totalChunksInPage: group.length,
                    isTable: false,
                    documentTitle: cfg.documentTitle,
                    ancestors: section.ancestors,
                    structurePath: section.ancestors.join(CRUMB) || undefined,
                };
                return finishChunk(childContent, "text", metadata, cfg);
            });

            const parentMetadata: ChunkMetadata = {
                pageNumber: section.page,
                chunkIndex: 0,
                totalChunksInPage: 0,
                isTable: false,
                documentTitle: cfg.documentTitle,
                ancestors: section.ancestors,
                structurePath: section.ancestors.join(CRUMB) || undefined,
            };
            const parent = finishChunk(group.join("\n"), "text", parentMetadata, cfg);
            parent.children = children;
            chunks.push(parent);
        }
    }

    // Tables arrive alongside the text rather than inside it, so they are
    // chunked per page as before — one parent, one child, description first.
    for (const page of pages) {
        for (const chunk of await chunkTables(page.tables, page.pageNumber, cfg)) {
            chunks.push(chunk);
        }
    }

    let index = 0;
    for (const chunk of chunks) {
        chunk.metadata.chunkIndex = index++;
        chunk.id = `page-${chunk.metadata.pageNumber}-chunk-${chunk.metadata.chunkIndex}`;
    }
    return chunks;
}

/** Contextualise, count, and stamp — the last step every chunk passes through. */
function finishChunk(
    body: string,
    type: "text" | "table",
    metadata: ChunkMetadata,
    cfg: ResolvedConfig
): DocumentChunk {
    const header = contextHeader(metadata);
    const content = header ? `${header}\n\n${body}` : body;
    return {
        id: "",
        content,
        type,
        metadata: {
            ...metadata,
            contextHeader: header ?? undefined,
            tokenCount: cfg.tokens.count(content),
            tokenCounterId: cfg.tokens.id,
        },
    };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

async function chunkTables(
    tables: ExtractedTable[],
    pageNumber: number,
    cfg: ResolvedConfig
): Promise<DocumentChunk[]> {
    return Promise.all(
        tables.map(async (table, tableIndex) => {
            const tableDescription = await generateTableDescription(table, pageNumber, tableIndex);
            const body = `${tableDescription}\n\n${table.markdown}`;
            const metadata: ChunkMetadata = {
                pageNumber,
                chunkIndex: 0,
                totalChunksInPage: 0,
                isTable: true,
                tableIndex,
                tableDescription,
                documentTitle: cfg.documentTitle,
            };
            const parent = finishChunk(body, "table", metadata, cfg);
            parent.children = [
                finishChunk(body, "table", { ...metadata, totalChunksInPage: 1 }, cfg),
            ];
            return parent;
        })
    );
}

async function generateTableDescription(
    table: ExtractedTable,
    pageNumber: number,
    tableIndex: number
): Promise<string> {
    // Use regex as fallback description base
    const headers = table.rows[0];
    let contentDescription = "structured data";
    if (headers && headers.length > 0) {
        const headerText = headers.join(" ").toLowerCase();
        if (headerText.includes("date") || headerText.includes("time")) {
            contentDescription = "time-series or dated information";
        } else if (
            headerText.includes("price") ||
            headerText.includes("cost") ||
            headerText.includes("amount")
        ) {
            contentDescription = "financial or pricing data";
        } else if (
            headerText.includes("name") &&
            (headerText.includes("role") || headerText.includes("title"))
        ) {
            contentDescription = "personnel or organizational information";
        } else if (
            headerText.includes("item") ||
            headerText.includes("product") ||
            headerText.includes("sku")
        ) {
            contentDescription = "inventory or product listing";
        } else if (
            headerText.includes("step") ||
            headerText.includes("action") ||
            headerText.includes("procedure")
        ) {
            contentDescription = "procedural steps or instructions";
        } else if (headers.length <= 3) {
            contentDescription = `data about ${headers.slice(0, 3).join(", ")}`;
        }
    }
    const sizeDescription = `${table.rowCount} rows × ${table.columnCount} columns`;
    const fallbackDesc = `Table from Page ${pageNumber} (Table ${tableIndex + 1}) containing ${contentDescription}. Size: ${sizeDescription}.`;

    // Try LLM summary if available
    const openai = getOpenAI();
    if (!openai) {
        return fallbackDesc;
    }

    try {
        const tablePreview = table.markdown.substring(0, 1000); // Limit context
        const response = await openai.chat.completions.create({
            model: GEMINI_FAST_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a concise data analyst. Summarize the following table in one sentence, describing what kind of data it contains and any key trends or categories. Do not list all rows.",
                },
                {
                    role: "user",
                    content: `Table headers: ${headers?.join(", ") ?? "None"}\n\nTable content snippet:\n${tablePreview}`,
                },
            ],
            max_tokens: 60,
        });

        const summary = response.choices[0]?.message?.content?.trim();
        if (summary) {
            return `Table on Page ${pageNumber}: ${summary}`;
        }
    } catch (error) {
        console.warn("Table summary generation failed, using fallback", error);
    }

    return fallbackDesc;
}

// ---------------------------------------------------------------------------
// Size-based splitting — the fallback for a single oversized unit
// ---------------------------------------------------------------------------

function splitWithOverlap(
    text: string,
    maxChars: number,
    overlapChars: number,
    tokens?: TokenCounter,
    budgetTokens?: number
): string[] {
    if (text.length <= maxChars) {
        return [text];
    }

    const chunks: string[] = [];
    let start = 0;
    let cutAtLine = false;

    while (start < text.length) {
        let end = Math.min(start + maxChars, text.length);

        if (end < text.length) {
            const searchStart = Math.max(start, end - Math.floor(maxChars * 0.2));
            const searchRegion = text.slice(searchStart, end);

            const sentenceMatch = searchRegion.match(/[.!?]\s+(?=[A-Z])/g);
            // Line-structured text — outlines, lists, code, transcripts —
            // has no sentence ends to cut at. A line break inside the search
            // window keeps every line whole, where the old fallback to the
            // last space could split "- Read replicas" into two chunks that
            // each say nothing.
            const lastNewline = searchRegion.lastIndexOf("\n");
            if (sentenceMatch) {
                const lastMatch = searchRegion.lastIndexOf(
                    sentenceMatch[sentenceMatch.length - 1]!
                );
                if (lastMatch !== -1) {
                    end = searchStart + lastMatch + 2;
                }
            } else if (lastNewline > 0) {
                end = searchStart + lastNewline + 1;
                cutAtLine = true;
            } else {
                const lastSpace = text.lastIndexOf(" ", end);
                if (lastSpace > start + maxChars * 0.5) {
                    end = lastSpace;
                }
            }
        }

        let piece = text.slice(start, end).trim();

        // The character budget is an approximation of the token budget. When a
        // real counter says the piece still overflows, walk the end back by
        // lines until it fits, so no chunk is ever handed to the embedding
        // model above its limit.
        if (tokens && budgetTokens && piece.length > 0) {
            let guard = 0;
            while (tokens.count(piece) > budgetTokens && guard++ < 40) {
                const cut = piece.lastIndexOf("\n");
                const next =
                    cut > 0 ? piece.slice(0, cut) : piece.slice(0, Math.floor(piece.length * 0.8));
                if (next.length === 0 || next.length === piece.length) break;
                end = start + next.length;
                piece = next.trim();
            }
        }

        if (piece.length > 0) {
            chunks.push(piece);
        }

        // The last chunk reached the end of the text: stop. Stepping back by
        // the overlap here used to emit one more chunk holding nothing but
        // the tail of the previous one — a junk fragment per long document,
        // embedded and retrievable like any other.
        if (end >= text.length) break;

        let newStart = end - overlapChars;
        if (cutAtLine && newStart > start) {
            // The overlap re-enters on a line boundary too, so the next chunk
            // opens with a whole line rather than the tail of one.
            const lineStart = text.lastIndexOf("\n", newStart) + 1;
            if (lineStart > start) newStart = lineStart;
            cutAtLine = false;
        }
        if (newStart > start && newStart < text.length) {
            start = newStart;
        } else {
            start = end;
        }

        if (start === end && start < text.length) {
            start = Math.min(start + 1, text.length);
        }
    }

    return chunks;
}

// ---------------------------------------------------------------------------
// Reporting and embedding hand-off
// ---------------------------------------------------------------------------

export function estimateTokens(text: string, charsPerToken = 4): number {
    return Math.ceil(text.length / charsPerToken);
}

export function getTotalChunkSize(chunks: DocumentChunk[]): {
    totalChunks: number;
    textChunks: number;
    tableChunks: number;
    totalCharacters: number;
    estimatedTokens: number;
} {
    const textChunks = chunks.filter(c => c.type === "text");
    const tableChunks = chunks.filter(c => c.type === "table");
    const totalCharacters = chunks.reduce((sum, c) => sum + c.content.length, 0);
    // Prefer the counted tokens the chunker recorded; fall back to the
    // estimate only for chunks that predate it.
    const totalTokens = chunks.reduce(
        (sum, c) => sum + (c.metadata.tokenCount ?? estimateTokens(c.content)),
        0
    );

    return {
        totalChunks: chunks.length,
        textChunks: textChunks.length,
        tableChunks: tableChunks.length,
        totalCharacters,
        estimatedTokens: totalTokens,
    };
}

/**
 * The strings handed to the embedding model: every child chunk's stored text.
 *
 * There is no prepending step any more. The breadcrumb is already part of
 * `content`, which is the point — what gets embedded is exactly what gets
 * stored, ranked lexically, read by the model and shown in a citation.
 */
export function prepareForEmbedding(chunks: DocumentChunk[]): string[] {
    const strings: string[] = [];
    for (const parent of chunks) {
        if (parent.children && parent.children.length > 0) {
            for (const child of parent.children) strings.push(child.content);
        } else {
            strings.push(parent.content);
        }
    }
    return strings;
}

/**
 * Merges generated embeddings back into the hierarchical structure.
 */
export function mergeWithEmbeddings(
    chunks: DocumentChunk[],
    embeddings: number[][],
    options?: {
        shortDimension?: number;
        supportsMatryoshka?: boolean;
    }
): VectorizedChunk[] {
    let embeddingIndex = 0;

    return chunks.map(parent => {
        const parentChildren = parent.children ?? [];
        const vectorizedChildren: VectorizedChunk[] = [];

        for (const child of parentChildren) {
            const vector = embeddings[embeddingIndex++];
            if (!vector) {
                throw new Error("Embedding mismatch: fewer embeddings than children");
            }
            const vectorShort =
                options?.supportsMatryoshka && options.shortDimension
                    ? vector.slice(0, options.shortDimension)
                    : undefined;

            vectorizedChildren.push({
                content: child.content,
                metadata: child.metadata,
                vector,
                vectorShort,
            });
        }

        if (parentChildren.length === 0) {
            // A parent with no children was itself embedded; keep the indexes
            // aligned so later parents do not consume the wrong vector.
            embeddingIndex++;
        }

        return {
            content: parent.content,
            metadata: parent.metadata,
            vector: [], // Parent has no vector in this design
            children: vectorizedChildren,
        };
    });
}
