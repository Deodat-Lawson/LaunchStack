/**
 * GitHub Repository Adapter
 *
 * Handles documents with mimeType = "text/x-github-repo".
 * The input is a combined text document with repo file contents,
 * structured with file paths and content blocks.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";
import type { ExtractedTable } from "~/lib/ocr/types";

export class GitHubRepoAdapter implements SourceAdapter {
  readonly name = "GitHubRepoAdapter";

  canHandle(mimeType: string, _extension: string, _filename?: string): boolean {
    return mimeType === "text/x-github-repo";
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(
      `[GitHubRepoAdapter] Processing: file=${options?.filename ?? "unknown"}`,
    );

    const text =
      Buffer.isBuffer(input) ? input.toString("utf-8") : input;

    const sections = this.splitIntoSections(text);
    const emptyTables: ExtractedTable[] = [];

    const pages: StandardizedPage[] = sections.map((section, idx) => ({
      pageNumber: idx + 1,
      textBlocks: [section],
      tables: emptyTables,
    }));

    if (pages.length === 0) {
      pages.push({
        pageNumber: 1,
        textBlocks: ["Empty repository content."],
        tables: emptyTables,
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[GitHubRepoAdapter] Done: ${pages.length} sections (${elapsed}ms)`,
    );

    return {
      pages,
      metadata: {
        sourceType: "github_repo",
        totalPages: pages.length,
        provider: "github_api",
        processingTimeMs: elapsed,
        confidenceScore: 95,
        originalFilename: options?.filename,
        mimeType: "text/x-github-repo",
      },
    };
  }

  /**
   * Split combined repo content into page-sized sections.
   * Tries to split on file boundaries (lines starting with "## File: ").
   */
  private splitIntoSections(text: string): string[] {
    const FILE_HEADER_RE = /^## File: /m;
    const MAX_SECTION_CHARS = 6000;

    if (!FILE_HEADER_RE.test(text)) {
      return this.splitBySize(text, MAX_SECTION_CHARS);
    }

    const parts = text.split(/(?=^## File: )/m).filter((p) => p.trim().length > 0);
    const sections: string[] = [];
    let buffer = "";

    for (const part of parts) {
      if (buffer.length + part.length > MAX_SECTION_CHARS && buffer.length > 0) {
        sections.push(buffer.trim());
        buffer = part;
      } else {
        buffer += (buffer.length > 0 ? "\n\n" : "") + part;
      }
    }

    if (buffer.trim().length > 0) {
      sections.push(buffer.trim());
    }

    return sections;
  }

  private splitBySize(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const sections: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(cursor + limit, text.length);
      if (end < text.length) {
        const lastNewline = text.lastIndexOf("\n", end);
        if (lastNewline > cursor + limit * 0.4) end = lastNewline;
      }
      const section = text.slice(cursor, end).trim();
      if (section.length > 0) sections.push(section);
      cursor = end;
    }
    return sections;
  }
}
