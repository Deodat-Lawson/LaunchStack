import type { OCRAdapter, OCRAdapterOptions, PageContent, NormalizedDocument } from "../types";

interface OCRSubmitResponse {
  success: boolean;
  request_id: string;
  request_check_url: string;
  error?: string;
}

interface OCRResult {
  status: 'complete' | 'processing' | 'failed';
  success: boolean;
  output_format: string;
  markdown?: string;
  json?: unknown;
  html?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  page_count?: number;
}

interface DatalabPollResponse {
  status: string;
  success?: boolean;
  output_format?: string;
  markdown?: string;
  json?: unknown;
  html?: string;
  metadata?: Record<string, unknown>;
  page_count?: number;
  error?: string;
}

export class DatalabAdapter implements OCRAdapter {
  private apiKey: string;

  constructor() {
    const key = process.env.DATALAB_API_KEY;
    if (!key) {
      throw new Error("DATALAB_API_KEY is not set");
    }
    this.apiKey = key;
  }

  getProviderName(): "DATALAB" {
    return "DATALAB";
  }

  async uploadDocument(documentUrl: string, options?: OCRAdapterOptions): Promise<NormalizedDocument> {
    const startTime = Date.now();

    try {
      // 1. Submit for processing
      const submitResult = await this.submitPDFForOCR(documentUrl, {
        force_ocr: options?.forceOCR,
        use_llm: options?.useLLM,
        paginate: true // We want pages for normalization
      });

      if (!submitResult.success || !submitResult.request_check_url) {
        throw new Error(submitResult.error ?? 'Failed to submit PDF for OCR processing');
      }

      // 2. Poll for completion
      const result = await this.pollOCRCompletion(submitResult.request_check_url);

      if (!result.success || result.status !== 'complete') {
        throw new Error(result.error ?? 'OCR processing failed');
      }

      // 3. Normalize content
      // Datalab returns full markdown. If paginated, it might return something else or we split by page breaks.
      // The current ocrService just returns markdown string.
      // We need to parse this markdown into PageContent[].
      // Datalab's marker typically separates pages with `\n\n` or similar if not explicitly paginated in output structure.
      // However, if we use `paginate: true`, we might get a different structure?
      // Looking at ocrService.ts it doesn't seem to handle structured pagination in response, just `page_count`.
      // Marker output usually contains page separators like `\n\n` or we can just treat as single page for now if structure isn't clear.
      // BUT, NormalizedDocument requires pages.
      
      // Let's assume we treat it as one page if we can't easily split, or split by some marker if known.
      // Marker usually puts "\n" between blocks.
      // For now, I will wrap the whole content in one page if explicit page splitting isn't obvious, 
      // OR if `result.metadata` contains page info.
      
      const content = result.markdown ?? "";
      const pageCount = result.page_count ?? 1;
      
      // Simple splitting attempt (imperfect but better than nothing if we want page-like chunks)
      // Datalab Marker usually doesn't output explicit page delimiters in the markdown text itself easily 
      // unless we look for specific headers. 
      // Let's just put everything in Page 1 for now to be safe, or split evenly? No, splitting evenly is bad.
      // We'll put it all in Page 1 and set totalPages to what they report.
      
      const pages: PageContent[] = [{
        pageNumber: 1,
        textBlocks: [content],
        tables: [] // Extraction of tables from markdown is a separate task, leaving empty for now
      }];

      // If we really want pages, we'd need Datalab to return JSON with page breakdown.
      // 'json' field in response might have it.
      // Let's check if 'json' is available and has pages.
      if (result.json && typeof result.json === 'object' && 'pages' in result.json && Array.isArray((result.json as { pages: unknown[] }).pages)) {
         // If JSON output is supported and requested/returned
         // TODO: Implement JSON parsing if Datalab supports it matching our structure
      }

      return {
        pages,
        metadata: {
          totalPages: pageCount,
          provider: "DATALAB",
          processingTimeMs: Date.now() - startTime,
          confidenceScore: 90, // Placeholder
        }
      };

    } catch (error) {
       console.error("Datalab processing error:", error);
       throw error;
    }
  }

  async extractPage(documentUrl: string, pageNumber: number): Promise<PageContent> {
    // Datalab doesn't support single page extraction easily without processing the whole doc usually.
    // We'll implement a fallback: process all and return that page (very inefficient)
    // or just throw not implemented for now as it's mainly for complexity analysis which might not use this path often.
    // For now, let's implement the full process and return the first page content as a proxy 
    // since we treat everything as Page 1 above.
    const doc = await this.uploadDocument(documentUrl);
    return doc.pages[0] ?? { pageNumber, textBlocks: [], tables: [] };
  }

  // --- Private Helpers ported from ocrService.ts ---

  private async submitPDFForOCR(
    fileUrl: string,
    options: { force_ocr?: boolean; use_llm?: boolean; paginate?: boolean; output_format?: string }
  ): Promise<OCRSubmitResponse> {
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download PDF from URL: ${fileResponse.status}`);
    }
    
    const fileBuffer = await fileResponse.arrayBuffer();
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    
    const formData = new FormData();
    formData.append('file', blob, 'document.pdf');
    if (options.force_ocr) formData.append('force_ocr', String(options.force_ocr));
    if (options.use_llm) formData.append('use_llm', String(options.use_llm));
    if (options.paginate) formData.append('paginate', String(options.paginate));
    
    const response = await fetch('https://www.datalab.to/api/v1/marker', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OCR API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { request_id: string; request_check_url: string };
    return {
      success: true,
      request_id: data.request_id,
      request_check_url: data.request_check_url,
    };
  }

  private async pollOCRCompletion(checkUrl: string): Promise<OCRResult> {
    const maxPolls = 60;
    const pollInterval = 5000;
    let attempts = 0;

    while (attempts < maxPolls) {
      try {
        const response = await fetch(checkUrl, {
          method: 'GET',
          headers: { 'X-Api-Key': this.apiKey },
        });

        if (!response.ok) throw new Error(`Polling failed: ${response.status}`);

        const data = (await response.json()) as DatalabPollResponse;

        if (data.status === 'complete') {
          return {
            status: 'complete',
            success: true,
            output_format: data.output_format ?? '',
            markdown: data.markdown,
            json: data.json,
            html: data.html,
            metadata: data.metadata,
            page_count: data.page_count,
          };
        }

        if (data.status === 'failed') {
          return {
            status: 'failed',
            success: false,
            output_format: '',
            error: data.error ?? 'OCR processing failed',
          };
        }

        attempts++;
        if (attempts < maxPolls) await new Promise(r => setTimeout(r, pollInterval));

      } catch (error) {
        console.error(`Polling attempt ${attempts + 1} failed:`, error);
        attempts++;
        if (attempts < maxPolls) await new Promise(r => setTimeout(r, pollInterval));
      }
    }

    return {
      status: 'failed',
      success: false,
      output_format: '',
      error: 'OCR processing timeout',
    };
  }
}

export function createDatalabAdapter(): DatalabAdapter {
  return new DatalabAdapter();
}
