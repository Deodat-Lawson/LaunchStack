import type { OCRProvider } from "~/lib/ocr/types";
import type { ClassificationResult } from "@huggingface/transformers";
import { PDFDocument } from "pdf-lib";

const SAMPLING_CONFIG = {
    MIN_PAGES_TO_SAMPLE: 3,
    MAX_PAGES_TO_SAMPLE: 5,
    VISION_MODEL_ID: "google/siglip-base-patch16-224",
    CONFIDENCE_THRESHOLD: 0.60,
    RENDER_SCALE: 2,
  };

const COMPLEX_LABELS = [
  "handwritten notes",
  "messy scanned document",
  "receipt or invoice",
  "complex table structure"
];

const SIMPLE_LABELS = [
  "digital text document",
  "clean screenshot",
  "blank page"
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

  return Array.from(pages).sort((a, b) => a - b).slice(0, SAMPLING_CONFIG.MAX_PAGES_TO_SAMPLE);
}

async function runVisionCheck(images: Uint8Array[]): Promise<VisionClassification> {
  console.log("Loading Vision Model (SigLIP) - lazy import with WASM backend...");
  const { pipeline } = await import("@huggingface/transformers");

  const classifier = await pipeline("zero-shot-image-classification", SAMPLING_CONFIG.VISION_MODEL_ID);

  let maxComplexityScore = 0;
  let dominantLabel = "digital text document";

  for (const image of images) {
    const result = await classifier(image, ALL_COMPLEXITY_LABELS) as ClassificationResult[];
    const topMatch = result[0];

    if (topMatch && COMPLEX_LABELS.includes(topMatch.label)) {
      if (topMatch.score > maxComplexityScore) {
        maxComplexityScore = topMatch.score;
        dominantLabel = topMatch.label;
      }
    }
  }

  if (maxComplexityScore === 0 && images.length > 0) {
     const result = await classifier(images[0]!, ALL_COMPLEXITY_LABELS) as ClassificationResult[];
     const firstResult = result[0];
     if (firstResult) {
       return { label: firstResult.label, score: firstResult.score };
     }
  }

  return { label: dominantLabel, score: maxComplexityScore };
}

export async function renderPagesToImages(buffer: ArrayBuffer, pageIndices: number[]): Promise<Uint8Array[]> {
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
        const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
        if (!errorMessage.includes('page number')) {
          console.warn(`Failed to render page ${pageIndex}:`, pageError);
        }
      }
    }

    return images;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.warn(`PDF rendering unavailable (${errorMessage}), falling back to OCR`);
    return [];
  }
}

function getDefaultOCRProvider(): OCRProvider {
  if (process.env.AZURE_DOC_INTELLIGENCE_KEY && process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT) return "AZURE";
  if (process.env.LANDING_AI_API_KEY) return "LANDING_AI";
  if (process.env.DATALAB_API_KEY) return "DATALAB";
  return "NATIVE_PDF";
}

export async function determineDocumentRouting(documentUrl: string): Promise<RoutingDecision> {
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
        pageCount
      };
    }
  } catch (e) {
    console.warn("PDF Structure load failed, assuming standard processing needed", e);
    pageCount = 1; 
  }

try {
    const { default: pdfParse } = await import("pdf-parse");
    const data = await pdfParse(new Uint8Array(buffer));
    const sampleText = data.text.substring(0, 200).trim();

    if (sampleText.length > 50) {
      return {
        provider: "NATIVE_PDF",
        reason: `Text layer detected (sampled ~${sampleText.length} chars)`,
        confidence: 0.95,
        pageCount: pageCount || data.numpages
      };
    }
  } catch (e: unknown) {
    const err = e as { code?: string; path?: string };
    if (err.code !== 'ENOENT' || !err.path?.includes('test/data')) {
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
         pageCount
        };
    }

    const visionResult = await runVisionCheck(images);

    if (COMPLEX_LABELS.includes(visionResult.label) && visionResult.score > SAMPLING_CONFIG.CONFIDENCE_THRESHOLD) {
      return {
        provider: "LANDING_AI",
        reason: `Vision detected '${visionResult.label}'`,
        confidence: visionResult.score,
        visionResult,
        pageCount
      };
    }

    const cleanFallback = getDefaultOCRProvider();
    return {
      provider: cleanFallback,
      reason: `Vision detected clean layout '${visionResult.label}', using ${cleanFallback}`,
      confidence: visionResult.score,
      visionResult,
      pageCount
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorFallback = getDefaultOCRProvider();
    if (!errorMessage.includes('ENOENT')) {
      console.warn(`Vision routing failed, defaulting to ${errorFallback}:`, errorMessage);
    }
    return {
      provider: errorFallback,
      reason: `Defaulting to ${errorFallback}`,
      confidence: 0.5,
      pageCount
    };
  }
}