/**
 * ASCII tree rendering from a flat path list — the same layout overview the
 * legacy repo-explainer built from the GitHub API tree, rebuilt over a local
 * listing. Deterministic: sorted, directories first, capped by depth and by
 * total characters with an explicit truncation marker.
 */
const DEFAULT_MAX_CHARS = 10_000;
const DEFAULT_MAX_DEPTH = 5;
export function renderTree(paths, options) {
    const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const root = { name: options?.rootLabel ?? ".", children: new Map(), isFile: false };
    for (const p of [...paths].sort()) {
        let node = root;
        const segments = p.split("/");
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const isFile = i === segments.length - 1;
            let child = node.children.get(segment);
            if (!child) {
                child = { name: segment, children: new Map(), isFile };
                node.children.set(segment, child);
            }
            node = child;
        }
    }
    const lines = [`${root.name}/`];
    let used = lines[0].length;
    let truncated = false;
    const visit = (node, prefix, depth) => {
        if (truncated)
            return;
        const children = [...node.children.values()].sort((a, b) => {
            if (a.isFile !== b.isFile)
                return a.isFile ? 1 : -1;
            return a.name < b.name ? -1 : 1;
        });
        children.forEach((child, index) => {
            if (truncated)
                return;
            const isLast = index === children.length - 1;
            const connector = isLast ? "└── " : "├── ";
            const suffix = child.isFile ? "" : "/";
            const line = `${prefix}${connector}${child.name}${suffix}`;
            if (used + line.length + 1 > maxChars) {
                truncated = true;
                return;
            }
            lines.push(line);
            used += line.length + 1;
            if (!child.isFile) {
                if (depth + 1 >= maxDepth) {
                    if (child.children.size > 0) {
                        const marker = `${prefix}${isLast ? "    " : "│   "}└── …`;
                        if (used + marker.length + 1 <= maxChars) {
                            lines.push(marker);
                            used += marker.length + 1;
                        }
                    }
                    return;
                }
                visit(child, `${prefix}${isLast ? "    " : "│   "}`, depth + 1);
            }
        });
    };
    visit(root, "", 0);
    if (truncated)
        lines.push("… (tree truncated at budget)");
    return lines.join("\n");
}
//# sourceMappingURL=tree-render.js.map