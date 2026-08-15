/**
 * Document complexity analysis and OCR provider selection, ported from
 * ocr-router's complexity.ts with the ADR-004 fixes:
 *
 * - Provider/vision configuration comes ONLY from the typed startup config —
 *   the per-request env map (`applyRequestEnv`) and its documented
 *   process.env mutation race are gone.
 * - No fabricated confidence: responses carry enumerated `reason`s plus
 *   `signals` holding real measurements (vision label/score, interactive
 *   form presence, sampled text length). The 0.99/0.95/0.5 constants do not
 *   exist here.
 * - Provider selection priority is preserved from the old
 *   getDefaultOCRProvider/getComplexDocProvider, with the old
 *   `OCR_WORKER_URL` presence check replaced by its consolidation-era
 *   equivalent, DOCLING_SERVE_URL. MARKER no longer exists as a provider
 *   name (rejected at startup, see config.ts).
 */
import { createRequire } from "node:module";

import { PDFDocument } from "pdf-lib";

import type { Config, OcrProvider } from "./config.js";
import type { RouteRequest, RouteResponse, RouteSignals, RoutingReason } from "./contracts.js";
import { errorMessage } from "./errors.js";
import { log } from "./logger.js";
import type { PageRenderer } from "./render.js";
import { COMPLEX_LABELS, COMPLEXITY_SCORE_THRESHOLD, type VisionClassifier } from "./vision.js";

export interface RoutingDeps {
    /** Fetches the (already allowlist-validated) document into memory. */
    fetchDocument: (url: string) => Promise<Buffer>;
    renderPages: PageRenderer;
    classify: VisionClassifier;
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

/**
 * Default provider priority (preserved from ocr-router):
 * operator-pinned OCR_DEFAULT_PROVIDER > Docling (self-hosted, zero cost)
 * > Azure > LandingAI > Datalab > Docling.
 */
export function getDefaultOcrProvider(config: Config): OcrProvider {
    if (config.defaultProvider) return config.defaultProvider;
    if (config.doclingServeUrl) return "DOCLING";
    if (config.azureKey && config.azureEndpoint) return "AZURE";
    if (config.landingAiApiKey) return "LANDING_AI";
    if (config.datalabApiKey) return "DATALAB";
    return "DOCLING";
}

/**
 * Complex-document priority (preserved): Docling > LandingAI > Azure >
 * Datalab > Docling. Deliberately does NOT honor the operator default —
 * same as the old router.
 */
export function getComplexDocProvider(config: Config): OcrProvider {
    if (config.doclingServeUrl) return "DOCLING";
    if (config.landingAiApiKey) return "LANDING_AI";
    if (config.azureKey && config.azureEndpoint) return "AZURE";
    if (config.datalabApiKey) return "DATALAB";
    return "DOCLING";
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

    // forceOCR means "run real OCR, never the native text path" — so the
    // default provider applies, remapped off NATIVE_PDF via the complex-doc
    // chain (which never yields NATIVE_PDF).
    if (request.forceOCR) {
        let provider = getDefaultOcrProvider(config);
        if (provider === "NATIVE_PDF") provider = getComplexDocProvider(config);
        return decision(provider, "force-ocr", {});
    }

    const buffer = await deps.fetchDocument(request.documentUrl);

    if (!looksLikePdf(buffer)) {
        return decision(getDefaultOcrProvider(config), "not-a-pdf", {});
    }

    let pageCount: number | undefined;
    let hasInteractiveForm: boolean | undefined;

    try {
        const doc = await PDFDocument.load(new Uint8Array(buffer), {
            ignoreEncryption: true,
        });
        pageCount = doc.getPageCount();
        hasInteractiveForm = doc.getForm().getFields().length > 0;

        if (hasInteractiveForm) {
            return decision(
                "NATIVE_PDF",
                "interactive-form",
                { hasInteractiveForm: true },
                pageCount
            );
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

        if (sampleText.length > 50) {
            return decision(
                "NATIVE_PDF",
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

    try {
        const pagesToSample = selectSamplePages(pageCount ?? 1);
        const images = await deps.renderPages(buffer, pagesToSample);

        if (images.length === 0) {
            return decision(
                getDefaultOcrProvider(config),
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

        if (COMPLEX_LABELS.includes(vision.label) && visionScore > COMPLEXITY_SCORE_THRESHOLD) {
            return decision(getComplexDocProvider(config), "vision-complex", signals, pageCount);
        }

        return decision(getDefaultOcrProvider(config), "vision-simple", signals, pageCount);
    } catch (err) {
        log("warn", "routing: vision path failed", {
            message: errorMessage(err),
        });
        return decision(
            getDefaultOcrProvider(config),
            "vision-unavailable",
            { hasInteractiveForm, textSampleChars },
            pageCount
        );
    }
}
