/**
 * Website Adapter
 *
 * Handles pre-fetched website HTML content (mimeType = "text/x-website").
 * Delegates to HtmlAdapter for the actual content extraction, tagging
 * metadata with the web_crawler provider.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
} from "../types";
import { HtmlAdapter } from "./html-adapter";

const htmlAdapter = new HtmlAdapter();

export class WebsiteAdapter implements SourceAdapter {
  readonly name = "WebsiteAdapter";

  canHandle(mimeType: string, _extension: string, _filename?: string): boolean {
    return mimeType === "text/x-website";
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    console.log(
      `[WebsiteAdapter] Processing website content: file=${options?.filename ?? "unknown"}`,
    );

    const result = await htmlAdapter.process(input, {
      ...options,
      mimeType: "text/html",
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `[WebsiteAdapter] Done: ${result.pages.length} pages (${elapsed}ms)`,
    );

    return {
      ...result,
      metadata: {
        ...result.metadata,
        sourceType: "website",
        provider: "web_crawler",
        processingTimeMs: elapsed,
        mimeType: "text/x-website",
      },
    };
  }
}
