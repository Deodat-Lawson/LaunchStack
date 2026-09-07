/**
 * Folders are paths.
 *
 * A folder is identified by a slash-separated path — `Contracts/2026/Globex` —
 * stored verbatim in `document.category` (the leaf folder a source lives in)
 * and in `category.name` (a folder that exists even while empty). Nesting is
 * a property of the string, so no column had to change and every existing
 * reader of `document.category` keeps working: it sees a longer name.
 *
 * `Unfiled` is the root bucket for sources that have no folder. It is a name
 * the UI reserves, not a row, and nothing can be nested under it.
 *
 * Everything here is pure and shared by the server module and the workspace
 * client, so the rules about what a folder may be called live in one place.
 */

export const FOLDER_SEPARATOR = "/";
export const UNFILED_FOLDER = "Unfiled";
/** `document.category` and `category.name` are both varchar(256). */
export const MAX_FOLDER_PATH_CHARS = 256;
export const MAX_FOLDER_NAME_CHARS = 80;
export const MAX_FOLDER_DEPTH = 8;

/** Segments of a path, trimmed, with empty segments dropped. */
export function splitFolderPath(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(FOLDER_SEPARATOR)
        .map(segment => segment.replace(/\s+/g, " ").trim())
        .filter(segment => segment.length > 0);
}

/** Join parts (each may itself be a path) into one normalized path. */
export function joinFolderPath(...parts: (string | null | undefined)[]): string {
    const segments = parts.flatMap(part => splitFolderPath(part));
    return segments.length > 0 ? segments.join(FOLDER_SEPARATOR) : UNFILED_FOLDER;
}

/** The canonical form of a stored or typed folder value. Empty means Unfiled. */
export function normalizeFolderPath(raw: string | null | undefined): string {
    return joinFolderPath(raw);
}

export function isUnfiledFolder(path: string | null | undefined): boolean {
    return normalizeFolderPath(path) === UNFILED_FOLDER;
}

export function folderLeafName(path: string): string {
    const segments = splitFolderPath(path);
    return segments[segments.length - 1] ?? UNFILED_FOLDER;
}

/** The folder this one sits in, or null at the top level. */
export function folderParentPath(path: string): string | null {
    const segments = splitFolderPath(path);
    if (segments.length <= 1) return null;
    return segments.slice(0, -1).join(FOLDER_SEPARATOR);
}

/** 0 at the top level. */
export function folderDepth(path: string): number {
    return Math.max(0, splitFolderPath(path).length - 1);
}

/** Every folder above this one, outermost first — `A`, `A/B` for `A/B/C`. */
export function folderAncestors(path: string): string[] {
    const segments = splitFolderPath(path);
    const out: string[] = [];
    for (let i = 1; i < segments.length; i++) {
        out.push(segments.slice(0, i).join(FOLDER_SEPARATOR));
    }
    return out;
}

/** True when `path` is `ancestor` itself or sits anywhere beneath it. */
export function isFolderOrDescendant(path: string, ancestor: string): boolean {
    const a = normalizeFolderPath(path);
    const b = normalizeFolderPath(ancestor);
    return a === b || a.startsWith(b + FOLDER_SEPARATOR);
}

/** True only when `path` sits strictly beneath `ancestor`. */
export function isFolderDescendant(path: string, ancestor: string): boolean {
    return (
        isFolderOrDescendant(path, ancestor) &&
        normalizeFolderPath(path) !== normalizeFolderPath(ancestor)
    );
}

/** Rewrite the leading `from` of a path to `to`; paths outside `from` are returned unchanged. */
export function replaceFolderPrefix(path: string, from: string, to: string): string {
    const p = normalizeFolderPath(path);
    const f = normalizeFolderPath(from);
    if (!isFolderOrDescendant(p, f)) return p;
    return joinFolderPath(to, p.slice(f.length));
}

/** How a path reads in a sentence or a menu: `Contracts / 2026`. */
export function displayFolderPath(path: string): string {
    return splitFolderPath(path).join(" / ") || UNFILED_FOLDER;
}

/** Why a single folder name is not acceptable, or null when it is. */
export function validateFolderName(name: string): string | null {
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) return "Folder name is required.";
    if (trimmed.includes(FOLDER_SEPARATOR))
        return `Folder names can't contain "${FOLDER_SEPARATOR}".`;
    if (trimmed.length > MAX_FOLDER_NAME_CHARS) {
        return `Folder name is too long (max ${MAX_FOLDER_NAME_CHARS} characters).`;
    }
    return null;
}

/** Why a full path is not acceptable as a folder, or null when it is. */
export function validateFolderPath(path: string): string | null {
    const segments = splitFolderPath(path);
    if (segments.length === 0) return "Folder name is required.";
    if (segments[0] === UNFILED_FOLDER) {
        return segments.length === 1
            ? `"${UNFILED_FOLDER}" is where sources without a folder live; it can't be created.`
            : `Folders can't be nested under "${UNFILED_FOLDER}".`;
    }
    for (const segment of segments) {
        const problem = validateFolderName(segment);
        if (problem) return problem;
    }
    if (segments.length > MAX_FOLDER_DEPTH) {
        return `Folders can be nested at most ${MAX_FOLDER_DEPTH} deep.`;
    }
    const joined = segments.join(FOLDER_SEPARATOR);
    if (joined.length > MAX_FOLDER_PATH_CHARS) {
        return `The full folder path is too long (max ${MAX_FOLDER_PATH_CHARS} characters).`;
    }
    return null;
}

/** Segment-wise, case-insensitive; `Unfiled` sorts last at the top level. */
export function compareFolderPaths(a: string, b: string): number {
    const sa = splitFolderPath(a);
    const sb = splitFolderPath(b);
    const len = Math.max(sa.length, sb.length);
    for (let i = 0; i < len; i++) {
        const x = sa[i];
        const y = sb[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        if (i === 0 && x !== y) {
            if (x === UNFILED_FOLDER) return 1;
            if (y === UNFILED_FOLDER) return -1;
        }
        const c = x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
        if (c !== 0) return c;
        // Names that differ only by case are different folders; order them
        // consistently so each one's subtree stays contiguous.
        if (x !== y) return x.localeCompare(y);
    }
    return 0;
}

/** Unique, normalized, with every ancestor present, sorted. */
export function expandFolderPaths(paths: Iterable<string | null | undefined>): string[] {
    const set = new Set<string>();
    for (const raw of paths) {
        const path = normalizeFolderPath(raw);
        set.add(path);
        if (path === UNFILED_FOLDER) continue;
        for (const ancestor of folderAncestors(path)) set.add(ancestor);
    }
    return [...set].sort(compareFolderPaths);
}

export interface FolderTreeNode<T> {
    path: string;
    /** The leaf name — what a row shows. */
    name: string;
    depth: number;
    children: FolderTreeNode<T>[];
    /** Items directly in this folder. */
    items: T[];
    /** Items in this folder and every folder beneath it. */
    totalItems: number;
}

export interface FolderTree<T> {
    /** Items directly at the scope root (only non-empty when `root` is a folder). */
    items: T[];
    children: FolderTreeNode<T>[];
}

/**
 * Arrange folders and the items inside them as a tree. With `root` set, the
 * tree is that folder's subtree: its own items plus its subfolders. With
 * `pruneEmpty`, folders holding nothing (directly or beneath) are dropped —
 * the shape a search wants.
 */
export function buildFolderTree<T>(
    folderPaths: Iterable<string>,
    items: readonly T[],
    folderOf: (item: T) => string | null | undefined,
    options: { root?: string | null; pruneEmpty?: boolean } = {}
): FolderTree<T> {
    const root = options.root ? normalizeFolderPath(options.root) : null;
    const itemsByPath = new Map<string, T[]>();
    for (const item of items) {
        const path = normalizeFolderPath(folderOf(item));
        const bucket = itemsByPath.get(path);
        if (bucket) bucket.push(item);
        else itemsByPath.set(path, [item]);
    }

    const allPaths = expandFolderPaths([...folderPaths, ...itemsByPath.keys()]);
    const nodes = new Map<string, FolderTreeNode<T>>();
    for (const path of allPaths) {
        nodes.set(path, {
            path,
            name: folderLeafName(path),
            depth: folderDepth(path),
            children: [],
            items: itemsByPath.get(path) ?? [],
            totalItems: 0,
        });
    }

    const top: FolderTreeNode<T>[] = [];
    for (const node of nodes.values()) {
        const parent = folderParentPath(node.path);
        const parentNode = parent ? nodes.get(parent) : undefined;
        if (parentNode) parentNode.children.push(node);
        else top.push(node);
    }

    const total = (node: FolderTreeNode<T>): number => {
        node.totalItems = node.items.length + node.children.reduce((n, c) => n + total(c), 0);
        return node.totalItems;
    };
    top.forEach(total);

    const prune = (list: FolderTreeNode<T>[]): FolderTreeNode<T>[] =>
        options.pruneEmpty
            ? list
                  .filter(node => node.totalItems > 0)
                  .map(node => ({ ...node, children: prune(node.children) }))
            : list;

    if (root) {
        const scope = nodes.get(root);
        return {
            items: scope?.items ?? itemsByPath.get(root) ?? [],
            children: prune(scope?.children ?? []),
        };
    }
    return { items: [], children: prune(top) };
}
