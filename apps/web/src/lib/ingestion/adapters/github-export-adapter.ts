import type {
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "@launchstack/core/ingestion/types";

interface GitHubLabel {
  name?: string;
}

interface GitHubAuthor {
  login?: string;
}

interface GitHubComment {
  body?: string;
  author?: GitHubAuthor;
  createdAt?: string;
}

interface GitHubItem {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: GitHubLabel[];
  author?: GitHubAuthor;
  createdAt?: string;
  closedAt?: string;
  mergedAt?: string;
  comments?: GitHubComment[];
}

const VALID_STATES = new Set(["OPEN", "CLOSED", "MERGED"]);

/**
 * Parses JSON output from `gh issue list --json` or `gh pr list --json`
 * into a StandardizedDocument.
 *
 * This is NOT a registered SourceAdapter -- it's called by the
 * JsonExportAdapter dispatcher when the JSON matches GitHub's shape.
 */
export function isGitHubExport(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  const sample = data.slice(0, 5);
  return sample.every(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      "number" in item &&
      "title" in item &&
      "state" in item,
  );
}

export function processGitHubExport(
  data: unknown[],
  options?: SourceAdapterOptions,
): StandardizedDocument {
  const startTime = Date.now();
  const items = data as GitHubItem[];

  const isPR = items.some((i) => i.mergedAt !== undefined || i.state === "MERGED");
  const kind = isPR ? "Pull Requests" : "Issues";
  const repoName = inferRepoName(options?.filename);

  console.log(
    `[GitHubExportAdapter] Processing ${items.length} ${kind} from ${repoName}`,
  );

  const grouped = groupByState(items);
  const stateOrder = ["OPEN", "CLOSED", "MERGED"];
  const pages: StandardizedPage[] = [];

  for (const state of stateOrder) {
    const group = grouped[state];
    if (!group || group.length === 0) continue;

    const blocks = group.map((item) => formatItem(item, isPR));
    const header = `# ${repoName} — ${kind} (${state})\n\n`;

    pages.push({
      pageNumber: pages.length + 1,
      textBlocks: [header + blocks.join("\n\n---\n\n")],
      tables: [],
    });
  }

  if (pages.length === 0) {
    pages.push({
      pageNumber: 1,
      textBlocks: [`No ${kind.toLowerCase()} found in ${repoName}.`],
      tables: [],
    });
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[GitHubExportAdapter] Done: ${pages.length} pages, ${items.length} items (${elapsed}ms)`,
  );

  return {
    pages,
    metadata: {
      sourceType: "text",
      totalPages: pages.length,
      provider: "native_text",
      processingTimeMs: elapsed,
      confidenceScore: 95,
      originalFilename: options?.filename,
      mimeType: options?.mimeType,
    },
  };
}

function inferRepoName(filename?: string): string {
  if (!filename) return "GitHub";
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  return base.replace(/\.json$/i, "").replace(/[-_]/g, " ") || "GitHub";
}

function groupByState(items: GitHubItem[]): Record<string, GitHubItem[]> {
  const groups: Record<string, GitHubItem[]> = {};
  for (const item of items) {
    const state = normalizeState(item);
    (groups[state] ??= []).push(item);
  }
  return groups;
}

function normalizeState(item: GitHubItem): string {
  const raw = (item.state ?? "OPEN").toUpperCase();
  if (VALID_STATES.has(raw)) return raw;
  if (item.mergedAt) return "MERGED";
  return "OPEN";
}

function formatItem(item: GitHubItem, isPR: boolean): string {
  const num = item.number ?? 0;
  const title = item.title ?? "Untitled";
  const state = normalizeState(item);
  const author = item.author?.login ?? "unknown";
  const created = formatDate(item.createdAt);
  const labels = (item.labels ?? []).map((l) => l.name).filter(Boolean).join(", ");
  const prefix = isPR ? "PR" : "Issue";

  const lines: string[] = [];
  lines.push(`## ${prefix} #${num}: ${title} [${state}]`);

  const meta: string[] = [`Author: ${author}`, `Created: ${created}`];
  if (labels) meta.push(`Labels: ${labels}`);
  if (item.closedAt) meta.push(`Closed: ${formatDate(item.closedAt)}`);
  if (item.mergedAt) meta.push(`Merged: ${formatDate(item.mergedAt)}`);
  lines.push(meta.join(" | "));

  if (item.body && item.body.trim()) {
    lines.push("");
    lines.push(item.body.trim());
  }

  const comments = item.comments ?? [];
  if (comments.length > 0) {
    lines.push("");
    lines.push(
      `### Comments (${comments.length})`,
    );
    for (const c of comments) {
      const cAuthor = c.author?.login ?? "unknown";
      const cDate = formatDate(c.createdAt);
      const cBody = (c.body ?? "").trim();
      if (cBody) {
        lines.push(`> ${cAuthor} (${cDate}): ${cBody.split("\n").join("\n> ")}`);
      }
    }
  }

  return lines.join("\n");
}

function formatDate(iso?: string | null): string {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
}
