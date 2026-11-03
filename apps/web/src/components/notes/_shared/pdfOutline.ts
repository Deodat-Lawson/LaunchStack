/**
 * The PDF outline (its bookmarks) as a tree the Contents panel can draw, and
 * the page-label helpers the panel shares with the viewer's page box.
 *
 * pdf.js hands the outline back raw: each entry names a destination that is
 * either a named destination (a string to look up) or an explicit one (an
 * array whose first element is a page reference). Resolving those is async
 * and can fail per entry in a damaged file, so this module turns the whole
 * thing into plain nodes with a 1-based page up front, once, and the panel
 * never touches pdf.js again.
 */

export interface PdfOutlineNode {
    id: string;
    title: string;
    /** 1-based; null when the destination could not be resolved. */
    page: number | null;
    children: PdfOutlineNode[];
}

/** What `getOutline()` returns — only the fields read here. */
export interface PdfOutlineItem {
    title: string;
    dest: string | unknown[] | null;
    items?: PdfOutlineItem[];
}

/**
 * The slice of pdf.js's PDFDocumentProxy the loader needs. Structural, so a
 * fake satisfies it in tests and the real proxy satisfies it in the viewer.
 */
export interface PdfOutlineSource {
    getOutline(): Promise<PdfOutlineItem[] | null>;
    getDestination(name: string): Promise<unknown[] | null>;
    getPageIndex(ref: unknown): Promise<number>;
}

/** The 1-based page a destination points at, or null when it cannot be known. */
async function resolvePage(
    pdf: PdfOutlineSource,
    dest: PdfOutlineItem["dest"]
): Promise<number | null> {
    try {
        const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || explicit.length === 0) return null;
        const target: unknown = explicit[0];
        if (target === null || target === undefined) return null;
        // Some generators write the page index itself instead of a reference;
        // pdf.js's own link service accepts both, so this does too.
        if (typeof target === "number") {
            return Number.isInteger(target) && target >= 0 ? target + 1 : null;
        }
        const index = await pdf.getPageIndex(target);
        return Number.isInteger(index) && index >= 0 ? index + 1 : null;
    } catch {
        return null;
    }
}

async function buildLevel(
    pdf: PdfOutlineSource,
    items: PdfOutlineItem[],
    prefix: string
): Promise<PdfOutlineNode[]> {
    const built = await Promise.all(
        items.map(async (item, index): Promise<PdfOutlineNode[]> => {
            // Ids follow the raw tree's positions, so they stay unique and
            // stable even when an untitled entry below is hoisted away.
            const id = prefix ? `${prefix}.${index}` : String(index);
            const title = (item.title ?? "").trim();
            const childItems = Array.isArray(item.items) ? item.items : [];
            // An untitled entry has nothing to show or click; its children
            // take its place at this level.
            if (!title) return buildLevel(pdf, childItems, id);
            const [page, children] = await Promise.all([
                resolvePage(pdf, item.dest),
                buildLevel(pdf, childItems, id),
            ]);
            return [{ id, title, page, children }];
        })
    );
    return built.flat();
}

/** The document's outline as nodes with resolved pages; [] when it has none. */
export async function loadPdfOutline(pdf: PdfOutlineSource): Promise<PdfOutlineNode[]> {
    let items: PdfOutlineItem[] | null;
    try {
        items = await pdf.getOutline();
    } catch {
        return [];
    }
    if (!items || items.length === 0) return [];
    return buildLevel(pdf, items, "");
}

/**
 * The node the reader is "in" on a page: flattening the tree in reading
 * order (a node before its children), the last node whose page is at or
 * before the given one. A child that starts on its parent's page comes
 * later in that order, so it wins the tie.
 */
export function currentOutlineId(nodes: PdfOutlineNode[], page: number): string | null {
    let best: string | null = null;
    const visit = (list: PdfOutlineNode[]) => {
        for (const node of list) {
            if (node.page !== null && node.page <= page) best = node.id;
            visit(node.children);
        }
    };
    visit(nodes);
    return best;
}

/** The label a document gives a 1-based page ("iv", "A-2"), else the number. */
export function pageLabelFor(labels: string[] | null, page: number): string {
    const label = labels?.[page - 1];
    return label !== undefined && label.trim() !== "" ? label : String(page);
}

/**
 * The page the reader meant by what they typed in the page box: a label,
 * matched whole and case-insensitively, wins over a plain number, because
 * a book whose front matter is "i…xii" numbers its first body page "1".
 */
export function pageFromLabel(
    labels: string[] | null,
    input: string,
    numPages: number
): number | null {
    const needle = input.trim();
    if (!needle) return null;
    if (labels) {
        const lower = needle.toLowerCase();
        const index = labels.findIndex(label => label.trim().toLowerCase() === lower);
        if (index !== -1 && index < numPages) return index + 1;
    }
    if (/^\d+$/.test(needle)) {
        const page = Number(needle);
        if (page >= 1 && page <= numPages) return page;
    }
    return null;
}

/**
 * Some generators wrap the whole outline in one node ("Table of Contents",
 * "Bookmarks") with every chapter beneath it. A tree whose single root exists
 * only to hold the others reads worse than the others alone, so that root is
 * dropped and its children become the top level.
 */
export function visibleOutlineRoots(nodes: PdfOutlineNode[]): PdfOutlineNode[] {
    const only = nodes.length === 1 ? nodes[0] : undefined;
    return only && only.children.length > 0 ? only.children : nodes;
}

export interface OutlineIndex {
    parents: Map<string, string | null>;
    depths: Map<string, number>;
}

/** Each node's parent and depth, for opening the way to the current node. */
export function indexOutline(nodes: PdfOutlineNode[]): OutlineIndex {
    const parents = new Map<string, string | null>();
    const depths = new Map<string, number>();
    const visit = (list: PdfOutlineNode[], parent: string | null, depth: number) => {
        for (const node of list) {
            parents.set(node.id, parent);
            depths.set(node.id, depth);
            visit(node.children, node.id, depth + 1);
        }
    };
    visit(nodes, null, 0);
    return { parents, depths };
}

/** The ids above a node, nearest first; empty for a root or for null. */
export function outlineAncestors(
    id: string | null,
    parents: Map<string, string | null>
): Set<string> {
    const out = new Set<string>();
    for (let cur = id ? parents.get(id) : null; cur; cur = parents.get(cur) ?? null) out.add(cur);
    return out;
}
