import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
} from "../types";
import { isGitHubExport, processGitHubExport } from "./github-export-adapter";

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  files?: { name?: string; title?: string; mimetype?: string }[];
}

/**
 * Unified JSON export adapter that dispatches to the correct handler
 * based on the structure of the parsed JSON content.
 *
 * Supported formats:
 *  - Slack workspace export (array of `{ type, text, ts }`)
 *  - GitHub CLI export (array of `{ number, title, state }`)
 *
 * Claims `.json` extension. On process(), parses the JSON, detects
 * the format, and delegates to the matching handler.
 */
export class JsonExportAdapter implements SourceAdapter {
  readonly name = "JsonExportAdapter";

  private static readonly EXTENSIONS = new Set([".json"]);

  canHandle(_mimeType: string, extension: string): boolean {
    return JsonExportAdapter.EXTENSIONS.has(extension.toLowerCase());
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const raw = await this.resolveInput(input);
    const parsed: unknown = JSON.parse(raw);

    if (isGitHubExport(parsed)) {
      return processGitHubExport(parsed as unknown[], options);
    }

    if (this.isSlackExport(parsed)) {
      return this.processSlackExport(parsed as SlackMessage[], options);
    }

    return this.processGenericJson(raw, options);
  }

  // ---------------------------------------------------------------------------
  // Generic JSON fallback
  // ---------------------------------------------------------------------------

  private processGenericJson(
    raw: string,
    options?: SourceAdapterOptions,
  ): StandardizedDocument {
    const startTime = Date.now();
    const filename = options?.filename ?? "unknown";
    console.log(
      `[JsonExportAdapter] Unrecognized JSON structure, treating as plain text: file=${filename}`,
    );

    const PAGE_CHAR_LIMIT = 4000;
    const pages: { pageNumber: number; textBlocks: string[]; tables: import("~/lib/ocr/types").ExtractedTable[] }[] = [];
    let cursor = 0;
    let pageNum = 1;
    while (cursor < raw.length) {
      let end = Math.min(cursor + PAGE_CHAR_LIMIT, raw.length);
      if (end < raw.length) {
        const lastNewline = raw.lastIndexOf("\n", end);
        if (lastNewline > cursor + PAGE_CHAR_LIMIT * 0.5) end = lastNewline + 1;
      }
      const chunk = raw.slice(cursor, end).trim();
      if (chunk.length > 0) {
        pages.push({ pageNumber: pageNum++, textBlocks: [chunk], tables: [] });
      }
      cursor = end;
    }

    if (pages.length === 0) {
      pages.push({ pageNumber: 1, textBlocks: [raw || "Empty JSON file."], tables: [] });
    }

    const elapsed = Date.now() - startTime;
    return {
      pages,
      metadata: {
        sourceType: "text",
        totalPages: pages.length,
        provider: "native_text",
        processingTimeMs: elapsed,
        confidenceScore: 70,
        originalFilename: filename,
        mimeType: options?.mimeType,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Slack handling
  // ---------------------------------------------------------------------------

  private processSlackExport(
    messages: SlackMessage[],
    options?: SourceAdapterOptions,
  ): StandardizedDocument {
    const startTime = Date.now();
    console.log(
      `[JsonExportAdapter/Slack] Processing: file=${options?.filename ?? "unknown"}`,
    );

    const filtered = messages.filter(
      (m) =>
        m.type === "message" &&
        !m.subtype?.startsWith("channel_") &&
        m.subtype !== "bot_message" &&
        typeof m.text === "string" &&
        m.text.trim().length > 0,
    );

    console.log(
      `[JsonExportAdapter/Slack] ${messages.length} total messages, ${filtered.length} after filtering`,
    );

    const channelName = this.inferChannelName(options?.filename);
    const grouped = this.groupByDate(filtered);
    const dateKeys = Object.keys(grouped).sort();

    const pages = dateKeys.map((date, idx) => {
      const dayMessages = grouped[date]!;
      const lines = dayMessages.map((m) => this.formatMessage(m));
      const header = `# ${channelName} — ${date}\n\n`;
      return {
        pageNumber: idx + 1,
        textBlocks: [header + lines.join("\n\n")],
        tables: [] as import("~/lib/ocr/types").ExtractedTable[],
      };
    });

    if (pages.length === 0) {
      pages.push({
        pageNumber: 1,
        textBlocks: [`No user messages found in ${channelName}.`],
        tables: [],
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[JsonExportAdapter/Slack] Done: ${pages.length} pages across ${dateKeys.length} days (${elapsed}ms)`,
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

  // ---------------------------------------------------------------------------
  // Slack detection and helpers
  // ---------------------------------------------------------------------------

  private isSlackExport(data: unknown): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    const sample = data.slice(0, 5);
    return sample.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "ts" in item &&
        ("text" in item || "type" in item),
    );
  }

  private async resolveInput(input: string | Buffer): Promise<string> {
    if (Buffer.isBuffer(input)) return input.toString("utf-8");
    if (
      input.startsWith("http://") ||
      input.startsWith("https://") ||
      input.startsWith("/")
    ) {
      const res = await fetch(input);
      if (!res.ok)
        throw new Error(`JsonExportAdapter fetch failed: ${res.status}`);
      return res.text();
    }
    return input;
  }

  private inferChannelName(filename?: string): string {
    if (!filename) return "Slack Channel";
    const parts = filename.replace(/\\/g, "/").split("/");
    if (parts.length >= 2) {
      return `#${parts[parts.length - 2]}`;
    }
    return `#${parts[0]!.replace(/\.json$/, "")}`;
  }

  private groupByDate(
    messages: SlackMessage[],
  ): Record<string, SlackMessage[]> {
    const groups: Record<string, SlackMessage[]> = {};
    for (const msg of messages) {
      const ts = parseFloat(msg.ts ?? "0");
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      (groups[date] ??= []).push(msg);
    }
    return groups;
  }

  private formatMessage(msg: SlackMessage): string {
    const ts = parseFloat(msg.ts ?? "0");
    const time = new Date(ts * 1000).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const user = msg.user ?? "unknown";
    const text = this.cleanSlackMarkup(msg.text ?? "");

    let formatted = `[${time}] ${user}: ${text}`;

    if (msg.files && msg.files.length > 0) {
      const fileNames = msg.files
        .map((f) => f.title ?? f.name ?? "attachment")
        .join(", ");
      formatted += ` [Attachments: ${fileNames}]`;
    }

    if (msg.reply_count && msg.reply_count > 0) {
      formatted += ` (${msg.reply_count} ${msg.reply_count === 1 ? "reply" : "replies"} in thread)`;
    }

    return formatted;
  }

  private cleanSlackMarkup(text: string): string {
    return (
      text
        .replace(/<@([A-Z0-9]+)>/g, "@$1")
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
        .replace(/<(https?:\/\/[^>]+)>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    );
  }
}

/** @deprecated Use JsonExportAdapter instead */
export const SlackExportAdapter = JsonExportAdapter;
