import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "../types";
import type { ExtractedTable } from "~/lib/ocr/types";

export class SpreadsheetAdapter implements SourceAdapter {
  readonly name = "SpreadsheetAdapter";

  private static readonly MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
  ]);

  private static readonly EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      SpreadsheetAdapter.MIME_TYPES.has(mimeType) ||
      SpreadsheetAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(`[SpreadsheetAdapter] Processing: file=${options?.filename ?? "unknown"}, mime=${options?.mimeType ?? "none"}`);

    const XLSX = await import("xlsx");

    const buffer = await this.resolveBuffer(input);
    console.log(`[SpreadsheetAdapter] Buffer resolved: ${buffer.length} bytes`);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    console.log(`[SpreadsheetAdapter] Workbook loaded: ${workbook.SheetNames.length} sheets (${workbook.SheetNames.join(", ")})`);

    const pages: StandardizedPage[] = [];

    for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
      const sheetName = workbook.SheetNames[sheetIdx]!;
      const sheet = workbook.Sheets[sheetName]!;

      const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      if (data.length === 0) {
        console.log(`[SpreadsheetAdapter] Sheet "${sheetName}": empty, skipping`);
        continue;
      }

      const TABLE_ROW_LIMIT = 50;
      const tables = this.buildTables(data, TABLE_ROW_LIMIT);
      console.log(
        `[SpreadsheetAdapter] Sheet "${sheetName}": ${data.length} rows × ${data[0]?.length ?? 0} cols → ${tables.length} table chunks`
      );

      const textSummary = `Sheet "${sheetName}": ${data.length} rows × ${(data[0]?.length ?? 0)} columns`;

      pages.push({
        pageNumber: sheetIdx + 1,
        textBlocks: [textSummary],
        tables,
      });
    }

    if (pages.length === 0) {
      console.warn("[SpreadsheetAdapter] No data found in any sheet");
      pages.push({
        pageNumber: 1,
        textBlocks: ["Empty spreadsheet — no data found."],
        tables: [],
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SpreadsheetAdapter] Done: ${pages.length} pages (${elapsed}ms)`);

    return {
      pages,
      metadata: {
        sourceType:
          options?.mimeType === "text/csv" || options?.mimeType === "application/csv"
            ? "csv"
            : "xlsx",
        totalPages: pages.length,
        provider: "sheetjs",
        processingTimeMs: elapsed,
        confidenceScore: 100,
        originalFilename: options?.filename,
        mimeType: options?.mimeType,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveBuffer(input: string | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;

    const res = await fetch(input);
    if (!res.ok)
      throw new Error(`SpreadsheetAdapter fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * Turn a 2D array of strings into ExtractedTable chunks.
   * Each chunk has at most `rowLimit` data rows plus the header row.
   */
  private buildTables(
    data: string[][],
    rowLimit: number,
  ): ExtractedTable[] {
    if (data.length === 0) return [];

    const headerRow = data[0]!;
    const dataRows = data.slice(1);
    const tables: ExtractedTable[] = [];

    for (let i = 0; i < dataRows.length; i += rowLimit) {
      const chunk = dataRows.slice(i, i + rowLimit);
      const rows = [headerRow, ...chunk];

      const markdown = this.toMarkdown(rows);

      tables.push({
        rows,
        markdown,
        rowCount: rows.length,
        columnCount: headerRow.length,
      });
    }

    // Edge case: header-only sheet
    if (dataRows.length === 0) {
      tables.push({
        rows: [headerRow],
        markdown: this.toMarkdown([headerRow]),
        rowCount: 1,
        columnCount: headerRow.length,
      });
    }

    return tables;
  }

  private toMarkdown(rows: string[][]): string {
    if (rows.length === 0) return "";

    const header = rows[0]!;
    const lines: string[] = [];

    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      // Pad or truncate to match header length
      const cells = header.map((_, idx) => row[idx] ?? "");
      lines.push(`| ${cells.join(" | ")} |`);
    }

    return lines.join("\n");
  }
}
