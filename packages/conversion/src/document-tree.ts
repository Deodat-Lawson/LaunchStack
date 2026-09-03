/**
 * The document tree — one canonical shape for structured content.
 *
 * Every adapter in this package can describe what it read as a tree of
 * elements: headings containing sections, list items containing sub-items,
 * paragraphs, tables, code blocks. The chunker walks that tree instead of
 * re-deriving structure from a flat string, which is what makes a chunk able
 * to name the section it came from.
 *
 * Two rules keep it honest:
 *
 * 1. **Built once, over the whole document.** The old path split a file into
 *    4,000-character pages *before* looking for headings and then ran the
 *    heading scan per page, so the heading stack reset at every boundary and
 *    content after one lost its ancestors. A tree is built from the whole
 *    text; page numbers are carried on nodes rather than bounding the parse.
 * 2. **Nesting is the structure.** A nested list is a hierarchy in its own
 *    right, not indented prose. That matters for outline-shaped sources — a
 *    published mindmap is exactly a nested list — where the indentation *is*
 *    the branch structure and flattening it loses the branch.
 */

export type DocumentNodeKind =
    | "root"
    | "heading"
    | "list-item"
    | "paragraph"
    | "table"
    | "code"
    | "quote";

export interface DocumentNode {
    kind: DocumentNodeKind;
    /**
     * The node's own label, without its marker: a heading without its `#`, a
     * list item without its bullet. This is what appears in an ancestor path.
     */
    text: string;
    /** The node's own source lines, markers intact, for re-rendering. */
    raw: string;
    /** Heading level (1-6), or list nesting depth. Absent for leaves. */
    level?: number;
    /** 1-based page the node started on, when the source was paginated. */
    page: number;
    children: DocumentNode[];
}

export interface DocumentTree {
    root: DocumentNode;
    /** True when the builder found real structure (headings or nested lists). */
    structured: boolean;
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE = /^(\s*)(```|~~~)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const QUOTE = /^\s*>\s?/;

function node(
    kind: DocumentNodeKind,
    text: string,
    raw: string,
    page: number,
    level?: number
): DocumentNode {
    return { kind, text, raw, page, level, children: [] };
}

/** Strip inline Markdown emphasis and links down to the words they wrap. */
function plainText(markdown: string): string {
    return markdown
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
        .replace(/(^|[^_])_([^_]+)_/g, "$1$2")
        .trim();
}

/**
 * Build a tree from Markdown or plain text.
 *
 * `pageStarts[i]` is the character offset at which page `i + 1` begins, so a
 * node can report the page it came from without the parse being bounded by
 * page edges.
 */
export function buildDocumentTree(text: string, pageStarts: number[] = [0]): DocumentTree {
    const root = node("root", "", "", 1);
    const lines = text.split("\n");

    // Heading stack: nodes that later headings nest under, by level.
    const headingStack: { level: number; node: DocumentNode }[] = [];
    // List stack: nodes that later list items nest under, by indent column.
    let listStack: { indent: number; node: DocumentNode }[] = [];

    let offset = 0;
    let pageIndex = 0;
    let sawStructure = false;
    /** Open paragraph / table / quote run, flushed when the shape changes. */
    let run: { kind: DocumentNodeKind; lines: string[]; page: number } | null = null;

    const pageAt = (at: number): number => {
        while (pageIndex + 1 < pageStarts.length && at >= pageStarts[pageIndex + 1]!) pageIndex++;
        return pageIndex + 1;
    };

    /** Where a new node belongs: deepest open list item, else deepest heading, else root. */
    const container = (): DocumentNode =>
        listStack.length > 0
            ? listStack[listStack.length - 1]!.node
            : headingStack.length > 0
              ? headingStack[headingStack.length - 1]!.node
              : root;

    const flushRun = () => {
        if (!run) return;
        const raw = run.lines.join("\n");
        const body = raw.trim();
        if (body.length > 0) {
            container().children.push(node(run.kind, plainText(body), raw, run.page));
        }
        run = null;
    };

    const openRun = (kind: DocumentNodeKind, line: string, page: number) => {
        if (run && run.kind !== kind) flushRun();
        run ??= { kind, lines: [], page };
        run.lines.push(line);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const page = pageAt(offset);
        offset += line.length + 1;

        // --- fenced code: consumed whole, never interpreted -----------------
        const fence = FENCE.exec(line);
        if (fence) {
            flushRun();
            const marker = fence[2]!;
            const block: string[] = [line];
            let j = i + 1;
            for (; j < lines.length; j++) {
                block.push(lines[j]!);
                offset += lines[j]!.length + 1;
                if (lines[j]!.trimStart().startsWith(marker)) break;
            }
            i = j;
            const raw = block.join("\n");
            container().children.push(node("code", raw, raw, page));
            continue;
        }

        const heading = ATX_HEADING.exec(line);
        if (heading) {
            flushRun();
            listStack = [];
            const level = heading[1]!.length;
            const title = plainText(heading[2]!);
            while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level)
                headingStack.pop();
            const parent =
                headingStack.length > 0 ? headingStack[headingStack.length - 1]!.node : root;
            const heading_ = node("heading", title, line, page, level);
            parent.children.push(heading_);
            headingStack.push({ level, node: heading_ });
            sawStructure = true;
            continue;
        }

        const item = LIST_ITEM.exec(line);
        if (item) {
            flushRun();
            const indent = item[1]!.length;
            const title = plainText(item[3]!);
            // Pop siblings and deeper items; what remains is this item's parent.
            while (listStack.length > 0 && listStack[listStack.length - 1]!.indent >= indent)
                listStack.pop();
            const parent =
                listStack.length > 0
                    ? listStack[listStack.length - 1]!.node
                    : headingStack.length > 0
                      ? headingStack[headingStack.length - 1]!.node
                      : root;
            const listItem = node("list-item", title, line, page, listStack.length + 1);
            parent.children.push(listItem);
            listStack.push({ indent, node: listItem });
            if (listStack.length > 1) sawStructure = true;
            continue;
        }

        if (line.trim().length === 0) {
            flushRun();
            continue;
        }

        // A non-list, non-blank line at column 0 ends any open list.
        if (listStack.length > 0 && /^\S/.test(line)) listStack = [];

        if (TABLE_ROW.test(line)) {
            openRun("table", line, page);
            continue;
        }
        if (QUOTE.test(line)) {
            openRun("quote", line, page);
            continue;
        }
        openRun("paragraph", line, page);
    }
    flushRun();

    return { root, structured: sawStructure };
}

/**
 * Concatenate page texts and report where each page began, so a tree can be
 * built over the whole document while still reporting page numbers.
 */
export function joinPages(pages: { pageNumber: number; textBlocks: string[] }[]): {
    text: string;
    pageStarts: number[];
} {
    const parts: string[] = [];
    const pageStarts: number[] = [];
    let offset = 0;
    for (const page of pages) {
        pageStarts.push(offset);
        const text = page.textBlocks.join("\n\n");
        parts.push(text);
        offset += text.length + 2;
    }
    return { text: parts.join("\n\n"), pageStarts: pageStarts.length > 0 ? pageStarts : [0] };
}

/** The node's own line plus every descendant's, as they appeared in the source. */
export function renderSubtree(n: DocumentNode): string {
    const out: string[] = [];
    const walk = (current: DocumentNode, isRoot: boolean) => {
        if (!isRoot || current.kind !== "root") {
            if (current.raw.trim().length > 0) out.push(current.raw);
        }
        for (const child of current.children) walk(child, false);
    };
    walk(n, true);
    return out.join("\n");
}

/** Every node in depth-first order, roots first. */
export function walkTree(n: DocumentNode, visit: (node: DocumentNode) => void): void {
    for (const child of n.children) {
        visit(child);
        walkTree(child, visit);
    }
}
