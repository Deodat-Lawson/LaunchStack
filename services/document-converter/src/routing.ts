/**
 * Document analysis and OCR provider selection, ported from ocr-router's
 * complexity.ts with the ADR-004 fixes:
 *
 * - Provider/vision configuration comes ONLY from the typed startup config —
 *   the per-request env map (`applyRequestEnv`) and its documented
 *   process.env mutation race are gone.
 * - No fabricated confidence: responses carry enumerated `reason`s plus
 *   `signals` holding real measurements (vision label/score, interactive
 *   form presence, sampled text length). The 0.99/0.95/0.5 constants do not
 *   exist here.
 * - One provider order for every document (./providers.ts): an OCR engine
 *   reads every PDF whenever one can run — text layer or not, form or not.
 *   The text-layer and AcroForm shortcuts to NATIVE_PDF apply only when no
 *   OCR engine is available. `reason` says what was measured about the
 *   document ("native-text-layer": it has one); `provider` says what reads it.
 */
import { createRequire } from "node:module";

import { PDFDocument } from "pdf-lib";

import type { Config, OcrProvider } from "./config.js";
import type { RouteRequest, RouteResponse, RouteSignals, RoutingReason } from "./contracts.js";
import { errorMessage } from "./errors.js";
import { log } from "./logger.js";
import { defaultProvider, forcedOcrProvider } from "./providers.js";
import type { PageRenderer } from "./render.js";
import { COMPLEX_LABELS, COMPLEXITY_SCORE_THRESHOLD, type VisionClassifier } from "./vision.js";

export interface RoutingDeps {
    /** Fetches the (already allowlist-validated) document into memory. */
    fetchDocument: (url: string) => Promise<Buffer>;
    renderPages: PageRenderer;
    classify: VisionClassifier;
    /** Whether docling-serve is answering right now (cached probe). */
    doclingReachable: () => Promise<boolean>;
}

const MIN_PAGES_TO_SAMPLE = 3;
const MAX_PAGES_TO_SAMPLE = 5;

/** First/middle/last (+1 random when >20 pages), max 5. 1-based. */
export function selectSamplePages(totalPages: number): number[] {
    if (totalPages <= MIN_PAGES_TO_SAMPLE) {
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
        .slice(0, MAX_PAGES_TO_SAMPLE);
}

function looksLikePdf(buffer: Buffer): boolean {
    // The PDF header may be preceded by up to 1024 bytes of junk per spec.
    return buffer.subarray(0, 1024).toString("latin1").includes("%PDF-");
}

/** Build a signals object without undefined keys (wire schema is strict). */
function buildSignals(values: RouteSignals): RouteSignals {
    const out: RouteSignals = {};
    if (values.visionLabel !== undefined) out.visionLabel = values.visionLabel;
    if (values.visionScore !== undefined) out.visionScore = values.visionScore;
    if (values.hasInteractiveForm !== undefined) {
        out.hasInteractiveForm = values.hasInteractiveForm;
    }
    if (values.textSampleChars !== undefined) {
        out.textSampleChars = values.textSampleChars;
    }
    return out;
}

function decision(
    provider: OcrProvider,
    reason: RoutingReason,
    signals: RouteSignals,
    pageCount?: number
): RouteResponse {
    return {
        schemaVersion: 1,
        provider,
        reason,
        ...(pageCount !== undefined && pageCount > 0 ? { pageCount } : {}),
        signals: buildSignals(signals),
    };
}

type PdfParseFn = (
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>
) => Promise<{ numpages: number; text: string }>;

let cachedPdfParse: PdfParseFn | undefined;

/**
 * pdf-parse is CJS and runs a debug branch at load time when it thinks it is
 * the entry module (reading ./test/data/… relative to CWD — the ENOENT
 * quirk the old router silenced). Loading through createRequire gives it a
 * CJS parent so the debug branch stays off; the ENOENT silencer below is
 * kept anyway to preserve the old behavior on exotic loaders.
 */
function loadPdfParse(): PdfParseFn {
    if (!cachedPdfParse) {
        const require = createRequire(import.meta.url);
        cachedPdfParse = require("pdf-parse") as PdfParseFn;
    }
    return cachedPdfParse;
}

export async function determineRouting(
    config: Config,
    deps: RoutingDeps,
    request: RouteRequest
): Promise<RouteResponse> {
    // Explicit caller choice wins outright (and beats forceOCR when both are
    // set — it is the more specific instruction).
    if (request.preferredProvider) {
        return decision(request.preferredProvider, "preferred-provider", {});
    }

    const doclingReachable = await deps.doclingReachable();
    const provider = defaultProvider(config, doclingReachable);

    // forceOCR means "run real OCR, never the native text path": the first
    // OCR engine, past a NATIVE_PDF pin. Only when none can run does it come
    // back NATIVE_PDF — the honest answer, rather than naming an engine that
    // will fail.
    if (request.forceOCR) {
        return decision(forcedOcrProvider(config, doclingReachable), "force-ocr", {});
    }

    const buffer = await deps.fetchDocument(request.documentUrl);

    if (!looksLikePdf(buffer)) {
        return decision(provider, "not-a-pdf", {});
    }

    let pageCount: number | undefined;
    let hasInteractiveForm: boolean | undefined;

    try {
        const doc = await PDFDocument.load(new Uint8Array(buffer), {
            ignoreEncryption: true,
        });
        pageCount = doc.getPageCount();
        hasInteractiveForm = doc.getForm().getFields().length > 0;

        // A form's filled-in values live in widget annotations the text
        // layer does not carry, so OCR reads it when it can.
        if (hasInteractiveForm) {
            return decision(provider, "interactive-form", { hasInteractiveForm: true }, pageCount);
        }
    } catch (err) {
        log("warn", "routing: pdf structure load failed", {
            message: errorMessage(err),
        });
    }

    let textSampleChars: number | undefined;

    try {
        const pdfParse = loadPdfParse();
        const data = await pdfParse(new Uint8Array(buffer));
        const sampleText = data.text.substring(0, 200).trim();
        textSampleChars = sampleText.length;
        if (pageCount === undefined && data.numpages > 0) {
            pageCount = data.numpages;
        }

        // A real text layer: OCR still reads it when an engine can run (it
        // recovers tables and reading order the layer loses); the text layer
        // is what reads it otherwise. Vision is skipped either way — it only
        // ever informed the scanned-page path.
        if (sampleText.length > 50) {
            return decision(
                provider,
                "native-text-layer",
                { hasInteractiveForm, textSampleChars },
                pageCount
            );
        }
    } catch (err) {
        // Preserved from ocr-router: silence pdf-parse's debug-mode ENOENT.
        const e = err as { code?: string; path?: string };
        if (e.code !== "ENOENT" || !e.path?.includes("test/data")) {
            log("warn", "routing: text extraction failed, proceeding to vision", {
                message: errorMessage(err),
            });
        }
    }

    // Little or no text layer: a scan. The vision label no longer picks the
    // engine (one order for every document); it is still measured because the
    // app's VLM enrichment reads it to decide whether scanned pages get a
    // visual description — the only text a scan gets when no OCR engine runs.
    try {
        const pagesToSample = selectSamplePages(pageCount ?? 1);
        const images = await deps.renderPages(buffer, pagesToSample);

        if (images.length === 0) {
            return decision(
                provider,
                "vision-unavailable",
                { hasInteractiveForm, textSampleChars },
                pageCount
            );
        }

        const vision = await deps.classify(images);
        const visionScore = Math.min(1, Math.max(0, vision.score));
        const signals: RouteSignals = {
            visionLabel: vision.label,
            visionScore,
            hasInteractiveForm,
            textSampleChars,
        };

        const complex =
            COMPLEX_LABELS.includes(vision.label) && visionScore > COMPLEXITY_SCORE_THRESHOLD;
        return decision(provider, complex ? "vision-complex" : "vision-simple", signals, pageCount);
    } catch (err) {
        log("warn", "routing: vision path failed", {
            message: errorMessage(err),
        });
        return decision(
            provider,
            "vision-unavailable",
            { hasInteractiveForm, textSampleChars },
            pageCount
        );
    }
}
