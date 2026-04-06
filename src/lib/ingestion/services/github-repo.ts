/**
 * GitHub Repository Service
 *
 * Fetches public GitHub repo contents via the REST API.
 * Supports fetching the full file tree, filtering relevant files,
 * and downloading file contents.
 */

const GITHUB_API = "https://api.github.com";

const SKIP_PATTERNS = [
  /^\.git\//,
  /node_modules\//,
  /__pycache__\//,
  /\.venv\//,
  /vendor\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /\.DS_Store$/,
  /Thumbs\.db$/i,
  /\.lock$/i,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.wasm$/,
  /\.pyc$/,
  /\.pyo$/,
  /\.o$/,
  /\.so$/,
  /\.dll$/i,
  /\.dylib$/,
  /\.class$/,
  /\.exe$/i,
  /\.bin$/i,
  /\.sqlite3?$/i,
  /\.db$/i,
];

const DOC_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".rst", ".adoc", ".asciidoc",
  ".html", ".htm", ".csv", ".json", ".yaml", ".yml", ".toml",
]);

const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
  ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".sh", ".bash", ".sql",
  ".r", ".lua", ".pl", ".scala", ".css", ".scss", ".less",
  ".vue", ".svelte",
]);

const MAX_FILE_SIZE_BYTES = 100_000;
const MAX_FILES_LIMIT = 200;

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

export interface RepoFile {
  path: string;
  type: "doc" | "code" | "config";
  size: number;
  content: string;
  sha: string;
}

export interface RepoFetchResult {
  owner: string;
  repo: string;
  branch: string;
  description: string | null;
  files: RepoFile[];
  totalFilesInRepo: number;
  skippedFiles: number;
  elapsedMs: number;
  errors: string[];
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubRepoResponse {
  default_branch: string;
  description: string | null;
  stargazers_count: number;
}

interface GitHubBranchResponse {
  commit: {
    sha: string;
  };
}

/**
 * Parse a GitHub URL into owner/repo and optional branch/path.
 */
export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;

    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;

    const result: GitHubRepoInfo = {
      owner: parts[0],
      repo: parts[1],
    };

    if (parts.length >= 4 && parts[2] === "tree") {
      result.branch = parts[3];
      if (parts.length > 4) {
        result.path = parts.slice(4).join("/");
      }
    }

    return result;
  } catch {
    return null;
  }
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "PDR-AI-Bot/1.0",
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function githubFetch<T>(path: string): Promise<T> {
  const url = `${GITHUB_API}${path}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${response.status}: ${response.statusText} - ${body.slice(0, 200)}`,
    );
  }

  return response.json() as Promise<T>;
}

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

function classifyFile(path: string): "doc" | "code" | "config" | null {
  const lower = path.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";

  if (lower === "readme.md" || lower.endsWith("/readme.md")) return "doc";
  if (lower === "readme" || lower.endsWith("/readme")) return "doc";

  if (DOC_EXTENSIONS.has(ext)) return "doc";
  if (CODE_EXTENSIONS.has(ext)) return "code";

  const configFiles = [
    "dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "makefile", ".env.example", "package.json", "tsconfig.json",
    "pyproject.toml", "setup.py", "setup.cfg", "cargo.toml",
    "go.mod", "go.sum", "gemfile", "requirements.txt",
  ];
  const basename = lower.split("/").pop() ?? "";
  if (configFiles.includes(basename)) return "config";

  return null;
}

/**
 * Fetch a public GitHub repository's contents.
 */
export async function fetchGitHubRepo(
  info: GitHubRepoInfo,
  options: { includeCode?: boolean } = {},
): Promise<RepoFetchResult> {
  const startTime = Date.now();
  const { owner, repo } = info;
  const includeCode = options.includeCode ?? true;
  const errors: string[] = [];

  console.log(
    `[GitHubRepo] Fetching: ${owner}/${repo}, branch=${info.branch ?? "default"}, includeCode=${includeCode}`,
  );

  const repoInfo = await githubFetch<GitHubRepoResponse>(
    `/repos/${owner}/${repo}`,
  );
  const branch = info.branch ?? repoInfo.default_branch;

  const branchInfo = await githubFetch<GitHubBranchResponse>(
    `/repos/${owner}/${repo}/branches/${branch}`,
  );
  const treeSha = branchInfo.commit.sha;

  const tree = await githubFetch<GitHubTreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
  );

  const allBlobs = tree.tree.filter((item) => item.type === "blob");
  const totalFilesInRepo = allBlobs.length;

  const candidates = allBlobs.filter((item) => {
    if (shouldSkip(item.path)) return false;
    if (info.path && !item.path.startsWith(info.path)) return false;
    if ((item.size ?? 0) > MAX_FILE_SIZE_BYTES) return false;

    const classification = classifyFile(item.path);
    if (!classification) return false;
    if (classification === "code" && !includeCode) return false;

    return true;
  });

  const sorted = candidates.sort((a, b) => {
    const classA = classifyFile(a.path);
    const classB = classifyFile(b.path);
    const order = { doc: 0, config: 1, code: 2 };
    return (order[classA!] ?? 3) - (order[classB!] ?? 3);
  });

  const toFetch = sorted.slice(0, MAX_FILES_LIMIT);
  const skippedFiles = totalFilesInRepo - toFetch.length;

  console.log(
    `[GitHubRepo] Tree: ${totalFilesInRepo} total blobs, ${toFetch.length} to fetch, ${skippedFiles} skipped`,
  );

  const files: RepoFile[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
        const response = await fetch(rawUrl, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${item.path}`);
        }
        const content = await response.text();
        return {
          path: item.path,
          type: classifyFile(item.path)!,
          size: item.size ?? content.length,
          content,
          sha: item.sha,
        } satisfies RepoFile;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        files.push(result.value);
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(
    `[GitHubRepo] Done: ${files.length} files fetched, ${errors.length} errors (${elapsedMs}ms)`,
  );

  return {
    owner,
    repo,
    branch,
    description: repoInfo.description,
    files,
    totalFilesInRepo,
    skippedFiles,
    elapsedMs,
    errors,
  };
}
