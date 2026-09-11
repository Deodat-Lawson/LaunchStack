/**
 * The memory-files bundle — the repo's own curated markdown, read first
 * because author-written context is the highest value per token the model
 * will ever get (design §3.3; the AGENTS.md / CLAUDE.md lesson).
 */
/** Priority order. Matching is case-insensitive on the basename; the first
 * hit per slot wins so `README.md` beats `readme.rst`. */
const MEMORY_FILE_SLOTS = [
    ["readme.md", "readme.rst", "readme.txt", "readme"],
    ["agents.md"],
    ["claude.md"],
    ["contributing.md"],
    ["architecture.md", "docs/architecture.md"],
    ["docs/readme.md"],
    [".github/copilot-instructions.md"],
];
const PER_FILE_CHAR_CAP = 20_000;
const TOTAL_CHAR_CAP = 48_000;
export async function collectMemoryFiles(view) {
    const files = await view.listFiles();
    const byLowerPath = new Map();
    for (const file of files)
        byLowerPath.set(file.path.toLowerCase(), file.path);
    const collected = [];
    let totalChars = 0;
    for (const slot of MEMORY_FILE_SLOTS) {
        let actualPath;
        for (const candidate of slot) {
            actualPath = byLowerPath.get(candidate);
            if (actualPath)
                break;
        }
        if (!actualPath)
            continue;
        if (totalChars >= TOTAL_CHAR_CAP)
            break;
        const content = await view.readFile(actualPath);
        if (content === null || content.trim().length === 0)
            continue;
        const budget = Math.min(PER_FILE_CHAR_CAP, TOTAL_CHAR_CAP - totalChars);
        const truncated = content.length > budget;
        const kept = truncated ? content.slice(0, budget) : content;
        collected.push({ path: actualPath, content: kept, truncated });
        totalChars += kept.length;
    }
    return collected;
}
//# sourceMappingURL=memory-files.js.map