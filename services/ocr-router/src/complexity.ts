/**
 * Document complexity analysis and OCR routing.
 * Standalone version for the ocr-router sidecar — no Next.js dependencies.
 *
 * Vision backend priority:
 *   1. OpenAI-compatible API (if OPENAI_API_KEY or AI_API_KEY is set)
 *   2. Local SigLIP via @huggingface/transformers (WASM fallback)
 */

import { PDFDocument } from "pdf-lib";

type OCRProvider =
  | "AZURE"
  | "LANDING_AI"
  | "NATIVE_PDF"
  | "DATALAB"
  | "DOCLING"
  | "MARKER"
  | "INGESTION";

const SAMPLING_CONFIG = {
  MIN_PAGES_TO_SAMPLE: 3,
  MAX_PAGES_TO_SAMPLE: 5,
  VISION_MODEL_ID: "google/siglip-base-patch16-224",
  CONFIDENCE_THRESHOLD: 0.6,
};

const COMPLEX_LABELS = [
  "handwritten notes",
  "messy scanned document",
  "receipt or invoice",
  "complex table structure",
];

const SIMPLE_LABELS = [
  "digital text document",
  "clean screenshot",
  "blank page",
];

const ALL_COMPLEXITY_LABELS = [...COMPLEX_LABELS, ...SIMPLE_LABELS];

interface VisionClassification {
  label: string;
  score: number;
}

export interface RoutingDecision {
  provider: OCRProvider;
  reason: string;
  confidence: number;
  pageCount: number;
  visionResult?: VisionClassification;
}

// ── Helpers ────────────────────────────────────────────────────────────

export function selectSamplePages(totalPages: number): number[] {
  if (totalPages <= SAMPLING_CONFIG.MIN_PAGES_TO_SAMPLE) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(Math.ceil(totalPages / 2));
  pages.add(totalPages);

  if (totalPages > 20) {
    const randomPage = Math.floor(Math.random() * (totalPages - 2)) + 2;
    pages.add(randomPage);
  }

  return Array.from(pages)
    .sort((a, b) => a - b)
    .slice(0, SAMPLING_CONFIG.MAX_PAGES_TO_SAMPLE);
}

// ── Vision backends ────────────────────────────────────────────────────

const OPENAI_CLASSIFY_PROMPT = `You are a document classifier. Analyze this image of a document page and classify it into EXACTLY ONE of these categories:

- "handwritten notes" — handwriting, pen/pencil marks
- "messy scanned document" — skewed, blurry, noisy scan
- "receipt or invoice" — receipts, invoices, financial forms
- "complex table structure" — dense tables, spreadsheet-like layouts
- "digital text document" — clean digital text, typed content
- "clean screenshot" — screenshot of a screen or app
- "blank page" — mostly empty

Respond with ONLY a JSON object: {"label": "<category>", "score": <confidence 0-1>}`;

async function runVisionCheckOpenAI(
  images: Uint8Array[]
): Promise<VisionClassification> {
  const apiKey =
    process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "";
  const baseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OCR_VISION_MODEL || "gpt-4o-mini";

  console.log(`[OCR Router] Using OpenAI vision (${model}) for classification`);

  let maxComplexityScore = 0;
  let dominantLabel = "digital text document";

  // Classify first image only (cost-effective — representative sample)
  const image = images[0];
  if (!image) return { label: dominantLabel, score: 0 };

  const b64 = Buffer.from(image).toString("base64");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OPENAI_CLASSIFY_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${b64}`, detail: "low" },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI vision failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content ?? "";

  try {
    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as { label: string; score: number };

    if (
      COMPLEX_LABELS.includes(parsed.label) &&
      parsed.score > maxComplexityScore
    ) {
      maxComplexityScore = parsed.score;
      dominantLabel = parsed.label;
    } else if (ALL_COMPLEXITY_LABELS.includes(parsed.label)) {
      dominantLabel = parsed.label;
      maxComplexityScore = parsed.score;
    }
  } catch {
    console.warn("[OCR Router] Failed to parse OpenAI vision response:", content);
  }

  return { label: dominantLabel, score: maxComplexityScore };
}

async function runVisionCheckSigLIP(
  images: Uint8Array[]
): Promise<VisionClassification> {
  console.log(
    "[OCR Router] Using local SigLIP model for classification (WASM)..."
  );
  const { pipeline } = await import("@huggingface/transformers");

  const classifier = await pipeline(
    "zero-shot-image-classification",
    SAMPLING_CONFIG.VISION_MODEL_ID
  );

  let maxComplexityScore = 0;
  let dominantLabel = "digital text document";

  for (const image of images) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await classifier(
      image as any,
      ALL_COMPLEXITY_LABELS
    )) as Array<{ label: string; score: number }>;
    const topMatch = result[0];

    if (topMatch && COMPLEX_LABELS.includes(topMatch.label)) {
      if (topMatch.score > maxComplexityScore) {
        maxComplexityScore = topMatch.score;
        dominantLabel = topMatch.label;
      }
    }
  }

  if (maxComplexityScore === 0 && images.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await classifier(
      images[0]! as any,
      ALL_COMPLEXITY_LABELS
    )) as Array<{ label: string; score: number }>;
    const firstResult = result[0];
    if (firstResult) {
      return { label: firstResult.label, score: firstResult.score };
    }
  }

  return { label: dominantLabel, score: maxComplexityScore };
}

/**
 * Run vision classification using the best available backend.
 * Prefers OpenAI (fast, accurate) over local SigLIP (free, slower).
 */
async function runVisionCheck(
  images: Uint8Array[]
): Promise<VisionClassification> {
  const hasOpenAI =
    process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

  if (hasOpenAI) {
    try {
      return await runVisionCheckOpenAI(images);
    } catch (err) {
      console.warn(
        "[OCR Router] OpenAI vision failed, falling back to SigLIP:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return runVisionCheckSigLIP(images);
}

// ── PDF rendering ──────────────────────────────────────────────────────

export async function renderPagesToImages(
  buffer: ArrayBuffer,
  pageIndices: number[]
): Promise<Uint8Array[]> {
  try {
    const { fromBuffer } = await import("pdf2pic");

    const converter = fromBuffer(Buffer.from(buffer), {
      density: 200,
      format: "png",
      width: 1024,
      height: 1448,
    });

    const images: Uint8Array[] = [];

    for (const pageIndex of pageIndices) {
      try {
        const result = await converter(pageIndex, { responseType: "buffer" });
        if (result?.buffer) {
          images.push(result.buffer);
        }
      } catch (pageError: unknown) {
        const errorMessage =
          pageError instanceof Error ? pageError.message : String(pageError);
        if (!errorMessage.includes("page number")) {
          console.warn(`Failed to render page ${pageIndex}:`, pageError);
        }
      }
    }

    return images;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "unknown error";
    console.warn(
      `PDF rendering unavailable (${errorMessage}), falling back to OCR`
    );
    return [];
  }
}

// ── Provider selection ─────────────────────────────────────────────────

function getDefaultOCRProvider(): OCRProvider {
  const configured = process.env.OCR_DEFAULT_PROVIDER?.toUpperCase();
  if (
    configured &&
    ["MARKER", "DOCLING", "NATIVE_PDF", "AZURE", "LANDING_AI", "DATALAB"].includes(configured)
  ) {
    return configured as OCRProvider;
  }
  // Default: Docling (self-hosted, zero cost) > cloud providers > NATIVE_PDF
  if (process.env.OCR_WORKER_URL) return "DOCLING";
  if (
    process.env.AZURE_DOC_INTELLIGENCE_KEY &&
    process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT
  )
    return "AZURE";
  if (process.env.LANDING_AI_API_KEY) return "LANDING_AI";
  if (process.env.DATALAB_API_KEY) return "DATALAB";
  return "DOCLING";
}

function getComplexDocProvider(): OCRProvider {
  if (process.env.OCR_WORKER_URL) return "DOCLING";
  if (process.env.LANDING_AI_API_KEY) return "LANDING_AI";
  if (
    process.env.AZURE_DOC_INTELLIGENCE_KEY &&
    process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT
  )
    return "AZURE";
  if (process.env.DATALAB_API_KEY) return "DATALAB";
  return "DOCLING";
}

// ── Main routing logic ─────────────────────────────────────────────────

export async function determineDocumentRouting(
  documentUrl: string
): Promise<RoutingDecision> {
  const response = await fetch(documentUrl);
  const buffer = await response.arrayBuffer();

  let pageCount = 0;
  let hasInteractiveForms = false;

  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
    hasInteractiveForms = doc.getForm().getFields().length > 0;

    if (hasInteractiveForms) {
      return {
        provider: "NATIVE_PDF",
        reason: "Interactive form fields detected",
        confidence: 0.99,
        pageCount,
      };
    }
  } catch (e) {
    console.warn(
      "PDF Structure load failed, assuming standard processing needed",
      e
    );
    pageCount = 1;
  }

  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(new Uint8Array(buffer));
    const sampleText = data.text.substring(0, 200).trim();

    if (sampleText.length > 50) {
      return {
        provider: "NATIVE_PDF",
        reason: `Text layer detected (sampled ~${sampleText.length} chars)`,
        confidence: 0.95,
        pageCount: pageCount || data.numpages,
      };
    }
  } catch (e: unknown) {
    const err = e as { code?: string; path?: string };
    if (err.code !== "ENOENT" || !err.path?.includes("test/data")) {
      console.warn("Text extraction failed, proceeding to vision check.", e);
    }
  }

  try {
    const pagesToSample = selectSamplePages(pageCount);
    const images = await renderPagesToImages(buffer, pagesToSample);

    if (images.length === 0) {
      const fallback = getDefaultOCRProvider();
      return {
        provider: fallback,
        reason: `No text layer detected, using ${fallback}`,
        confidence: 0.5,
        pageCount,
      };
    }

    const visionResult = await runVisionCheck(images);

    if (
      COMPLEX_LABELS.includes(visionResult.label) &&
      visionResult.score > SAMPLING_CONFIG.CONFIDENCE_THRESHOLD
    ) {
      const complexProvider = getComplexDocProvider();
      return {
        provider: complexProvider,
        reason: `Vision detected '${visionResult.label}', using ${complexProvider}`,
        confidence: visionResult.score,
        visionResult,
        pageCount,
      };
    }

    const cleanFallback = getDefaultOCRProvider();
    return {
      provider: cleanFallback,
      reason: `Vision detected clean layout '${visionResult.label}', using ${cleanFallback}`,
      confidence: visionResult.score,
      visionResult,
      pageCount,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorFallback = getDefaultOCRProvider();
    if (!errorMessage.includes("ENOENT")) {
      console.warn(
        `Vision routing failed, defaulting to ${errorFallback}:`,
        errorMessage
      );
    }
    return {
      provider: errorFallback,
      reason: `Defaulting to ${errorFallback}`,
      confidence: 0.5,
      pageCount,
    };
  }
}
