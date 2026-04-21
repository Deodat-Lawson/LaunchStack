import type { DiagramType, RepoInfo, StatusCallback } from "./types";
import { getFilesToExplore } from "./llm";

const IMPORTANT_FILES = [ 
  "README.md",
  "package.json",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "setup.py",
  "pyproject.toml",
  ".env.example",
  "Dockerfile",
  "docker-compose.yml",
  "Makefile",
  "LICENSE",
  "CONTRIBUTING.md",
  "Pipfile",
] as const;

const TREE_DEPTH = 5;
const MAX_TOTAL_CHARS = 100_000;
const MAX_FILE_CHARS = 30_000;
const MAX_FILES_TO_FETCH = 25;

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
}

interface TreeNode {
  _type: "blob" | "tree";
  children?: Record<string, TreeNode>;
}

async function githubJsonFetch<T>(
  url: string,
  githubToken?: string | null,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(githubToken
        ? { Authorization: `Bearer ${githubToken}` }
        : {}),
      ...(init?.headers ?? {}),
    },
    // In Next.js route handlers, Node fetch is available
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub API error ${res.status} for ${url}: ${text.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

async function githubTextFetch(
  url: string,
  githubToken?: string | null,
  init?: RequestInit,
): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(githubToken
        ? { Authorization: `Bearer ${githubToken}` }
        : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (res.status === 404) {
    // Callers treat this as "not found" rather than throwing
    return "";
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub raw contents error ${res.status} for ${url}: ${text.slice(0, 500)}`,
    );
  }
  return await res.text();
}

async function getDefaultBranch(
  repo: RepoInfo,
  githubToken?: string | null,
): Promise<string> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repoName}`;
  const data = await githubJsonFetch<{ default_branch?: string }>(url, githubToken);
  return data.default_branch || "main";
}

function buildHierarchicalTree(flat: GitHubTreeItem[]): Record<string, TreeNode> {
  const root: Record<string, TreeNode> = {};
  for (const item of flat) {
    const segments = item.path.split("/");
    let current: Record<string, TreeNode> = root;
    segments.forEach((segment, index) => {
      if (!segment) return;
      const isLast = index === segments.length - 1;
      if (isLast) {
        current[segment] = { _type: item.type };
      } else {
        if (!current[segment]) {
          current[segment] = { _type: "tree", children: {} };
        }
        if (!current[segment].children) {
          current[segment].children = {};
        }
        current = current[segment].children!;
      }
    });
  }
  return root;
}

function formatTreeRecursively(
  node: Record<string, TreeNode>,
  prefix: string,
  lines: string[],
  depth: number,
  maxDepth: number | null,
): void {
  if (maxDepth !== null && depth >= maxDepth) return;

  const names = Object.keys(node).sort();
  names.forEach((name, idx) => {
    const data = node[name]!;
    const isLast = idx === names.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const isDir = data._type === "tree";
    const line = `${prefix}${connector}${name}${isDir ? "/" : ""}`;
    lines.push(line);
    if (isDir && data.children) {
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      formatTreeRecursively(
        data.children,
        childPrefix,
        lines,
        depth + 1,
        maxDepth,
      );
    }
  });
}

async function fetchDirectoryTreeWithDepth(
  repo: RepoInfo,
  depth: number | null = TREE_DEPTH,
  githubToken?: string | null,
  ref?: string | null,
): Promise<string> {
  const branch = ref || (await getDefaultBranch(repo, githubToken));
  const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.repoName}/git/trees/${branch}?recursive=1`;

  const data = await githubJsonFetch<{ tree?: GitHubTreeItem[]; truncated?: boolean }>(
    treeUrl,
    githubToken,
  );

  const flatTree = data.tree ?? [];
  if (!flatTree.length) {
    return `Directory structure:\n└── ${repo.owner}/${repo.repoName}/\n    (Repository is empty or tree data not available)`;
  }

  const hierarchical = buildHierarchicalTree(flatTree);
  const lines: string[] = ["Directory structure:", `└── ${repo.owner}/${repo.repoName}/`];

  const effectiveDepth =
    depth === null || depth < 0 ? null : Math.max(0, depth - 1);

  formatTreeRecursively(hierarchical, "    ", lines, 0, effectiveDepth);
  return lines.join("\n");
}

async function listDirectoryFiles(
  repo: RepoInfo,
  path = "",
  githubToken?: string | null,
  ref?: string | null,
): Promise<string[]> {
  const cleanPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const url = new URL(
    `https://api.github.com/repos/${repo.owner}/${repo.repoName}/contents/${cleanPath}`,
  );
  if (ref) url.searchParams.set("ref", ref);

  const data = await githubJsonFetch<any[]>(url.toString(), githubToken);
  if (!Array.isArray(data)) return [];
  const files: string[] = [];
  for (const entry of data) {
    if (entry?.type === "file" && typeof entry.path === "string") {
      files.push(entry.path);
    }
  }
  return files;
}

async function getFileContents(
  repo: RepoInfo,
  path: string,
  githubToken?: string | null,
  ref?: string | null,
): Promise<string | null> {
  const url = new URL(
    `https://api.github.com/repos/${repo.owner}/${repo.repoName}/contents/${path}`,
  );
  if (ref) url.searchParams.set("ref", ref);
  const text = await githubTextFetch(url.toString(), githubToken);
  if (!text) return null;
  return text;
}

export async function getRepoContext(
  repo: RepoInfo,
  ref: string | null,
  githubToken?: string | null,
  statusCallback?: StatusCallback,
  diagramType?: DiagramType,
): Promise<{ context: string; success: boolean; error?: string }> {
  try {
    let totalChars = 0;
    const parts: string[] = [];

    if (statusCallback) statusCallback("fetching_tree");
    let tree = await fetchDirectoryTreeWithDepth(repo, TREE_DEPTH, githubToken, ref);
    if (tree.length > 10_000) {
      tree = "(Tree content cropped to 10k characters)\n" + tree.slice(0, 10_000);
    }
    parts.push(tree + "\n");
    totalChars += tree.length;

    const rootFiles = await listDirectoryFiles(repo, "", githubToken, ref);
    const rootImportant = IMPORTANT_FILES.filter((f) => rootFiles.includes(f));

    if (statusCallback) statusCallback("exploring_files");
    const llmPaths = await getFilesToExplore(tree, `${repo.owner}/${repo.repoName}`, diagramType);

    const merged = Array.from(
      new Map<string, true>(
        [...rootImportant, ...llmPaths].map((p) => [p, true as const]),
      ).keys(),
    ).slice(0, MAX_FILES_TO_FETCH);

    if (!merged.length) {
      return {
        context: "No key documentation files found in root.",
        success: true,
      };
    }

    if (statusCallback) statusCallback("fetching_files");
    const contents = await Promise.all(
      merged.map((p) => getFileContents(repo, p, githubToken, ref)),
    );

    for (let i = 0; i < merged.length; i += 1) {
      const path = merged[i];
      let content = contents[i];
      if (!content) continue;

      if (content.length > MAX_FILE_CHARS) {
        content =
          content.slice(0, MAX_FILE_CHARS) +
          "\n... (file truncated for length)\n";
      }

      const addition =
        "================================================\n" +
        `FILE: ${path}\n` +
        "================================================\n" +
        content +
        "\n";

      if (totalChars + addition.length > MAX_TOTAL_CHARS) {
        parts.push("(Remaining files skipped to stay under context limit.)\n");
        break;
      }

      parts.push(addition);
      totalChars += addition.length;
    }

    return { context: parts.join("\n"), success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error building repo context";
    return { context: message, success: false, error: message };
  }
}

