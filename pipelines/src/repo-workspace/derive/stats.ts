/**
 * Deterministic repo statistics — "what kind of repo is this" without a
 * model call (design §3.3).
 */

import type { DirectoryStat, LanguageStat, RepoStats, WorkspaceFile } from "../types";

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".java": "Java",
    ".kt": "Kotlin",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".c": "C",
    ".h": "C",
    ".cpp": "C++",
    ".hpp": "C++",
    ".swift": "Swift",
    ".scala": "Scala",
    ".sh": "Shell",
    ".sql": "SQL",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "CSS",
    ".md": "Markdown",
    ".mdx": "Markdown",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
};

const MAX_LANGUAGES = 10;
const MAX_DIRECTORIES = 8;

function languageForPath(filePath: string): string {
    const dot = filePath.lastIndexOf(".");
    if (dot === -1) return "Other";
    const ext = filePath.slice(dot).toLowerCase();
    return EXTENSION_LANGUAGES[ext] ?? "Other";
}

export function computeRepoStats(files: WorkspaceFile[]): RepoStats {
    let totalBytes = 0;
    const languageAgg = new Map<string, { files: number; bytes: number }>();
    const directoryAgg = new Map<string, { files: number; bytes: number }>();

    for (const file of files) {
        totalBytes += file.size;

        const language = languageForPath(file.path);
        const lang = languageAgg.get(language) ?? { files: 0, bytes: 0 };
        lang.files += 1;
        lang.bytes += file.size;
        languageAgg.set(language, lang);

        const slash = file.path.indexOf("/");
        const topDir = slash === -1 ? "." : file.path.slice(0, slash);
        const dir = directoryAgg.get(topDir) ?? { files: 0, bytes: 0 };
        dir.files += 1;
        dir.bytes += file.size;
        directoryAgg.set(topDir, dir);
    }

    const languages: LanguageStat[] = [...languageAgg.entries()]
        .map(([language, agg]) => ({ language, ...agg }))
        .sort((a, b) =>
            b.bytes !== a.bytes ? b.bytes - a.bytes : a.language < b.language ? -1 : 1
        )
        .slice(0, MAX_LANGUAGES);

    const largestDirectories: DirectoryStat[] = [...directoryAgg.entries()]
        .map(([path, agg]) => ({ path, ...agg }))
        .sort((a, b) => (b.bytes !== a.bytes ? b.bytes - a.bytes : a.path < b.path ? -1 : 1))
        .slice(0, MAX_DIRECTORIES);

    return { totalFiles: files.length, totalBytes, languages, largestDirectories };
}

export function renderRepoStats(stats: RepoStats): string {
    const languages = stats.languages.map(l => `${l.language} (${l.files} files)`).join(", ");
    const directories = stats.largestDirectories
        .map(d => `${d.path}/ (${d.files} files)`)
        .join(", ");
    return [
        `Files: ${stats.totalFiles} · ${Math.round(stats.totalBytes / 1024)} KiB`,
        `Languages: ${languages || "none detected"}`,
        `Largest directories: ${directories || "flat"}`,
    ].join("\n");
}
