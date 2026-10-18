/**
 * Which OCR provider reads a document, and what it falls back to — the one
 * order every app-side path uses (routing's local fallback, forceOCR,
 * normalizeDocument's fallback chain, the image converter):
 *
 *   1. OCR_DEFAULT_PROVIDER, when an operator pinned one and it can run here
 *   2. AZURE — Document Intelligence, when its endpoint and key are set
 *   3. DOCLING — only when the document converter reports docling-serve
 *      answering (GET /capabilities), never because a URL is configured
 *   4. LANDING_AI
 *   5. DATALAB
 *   → the PDF's own text layer (NATIVE_PDF) or Tesseract for images, last.
 *
 * services/document-converter/src/providers.ts keeps the same list for
 * /route (it lives outside the pnpm workspace and cannot import this file);
 * a test on each side pins the order.
 */

import { getOcrConfig } from "./config";
import type { OcrConfig } from "./config-types";
import type { OCRProvider } from "./types";

/** OCR engines in preference order, before the operator pin is applied. */
export const OCR_PROVIDER_ORDER = ["AZURE", "DOCLING", "LANDING_AI", "DATALAB"] as const;
export type OcrEngine = (typeof OCR_PROVIDER_ORDER)[number];

export function isOcrEngine(provider: string | undefined): provider is OcrEngine {
    return (OCR_PROVIDER_ORDER as readonly string[]).includes(provider ?? "");
}

/** Which engines can run right now. */
export type OcrAvailability = Record<OcrEngine, boolean>;

/** Credentials-only availability; Docling needs the converter's word (see {@link isDoclingReachable}). */
export function configuredOcrAvailability(
    cfg: OcrConfig = getOcrConfig(),
    doclingReachable = false
): OcrAvailability {
    return {
        AZURE: Boolean(cfg.azure?.endpoint && cfg.azure.key),
        DOCLING: Boolean(cfg.converter?.url) && doclingReachable,
        LANDING_AI: Boolean(cfg.landingAi?.apiKey),
        DATALAB: Boolean(cfg.datalabApiKey),
    };
}

/** Available engines in the order they are tried, an available operator pin first. */
export function orderOcrEngines(
    availability: OcrAvailability,
    pin: OCRProvider | undefined = getOcrConfig().defaultProvider
): OcrEngine[] {
    const available = OCR_PROVIDER_ORDER.filter(provider => availability[provider]);
    if (isOcrEngine(pin) && available.includes(pin)) {
        return [pin, ...available.filter(provider => provider !== pin)];
    }
    return available;
}

/**
 * The provider for a PDF nobody chose one for: the first engine that can
 * run, else the text layer. An operator NATIVE_PDF pin keeps unforced PDFs on
 * the text layer; `forceOCR` gets past it.
 */
export function defaultOcrProvider(
    availability: OcrAvailability,
    options: { forceOCR?: boolean } = {}
): OCRProvider {
    const pin = getOcrConfig().defaultProvider;
    if (pin === "NATIVE_PDF" && !options.forceOCR) return "NATIVE_PDF";
    return orderOcrEngines(availability, pin)[0] ?? "NATIVE_PDF";
}

/**
 * What to try, in order, when `first` is the provider routing chose: `first`,
 * then every other engine that can run, then the text layer for a PDF.
 * NATIVE_PDF as the choice — someone picked the text-only method, an
 * operator pinned it, or no engine could run — stays exactly that.
 */
export function ocrFallbackChain(
    first: OCRProvider,
    available: readonly OcrEngine[],
    options: { isPdf: boolean }
): OCRProvider[] {
    if (!isOcrEngine(first)) return ["NATIVE_PDF"];
    const chain: OCRProvider[] = [first, ...available.filter(provider => provider !== first)];
    if (options.isPdf) chain.push("NATIVE_PDF");
    return chain;
}

// ---------------------------------------------------------------------------
// Docling reachability, as the document converter reports it
// ---------------------------------------------------------------------------

const CAPABILITIES_TIMEOUT_MS = 2500;
const OK_TTL_MS = 30_000;
const FAIL_TTL_MS = 15_000;

let cached: { converterUrl: string; reachable: boolean; at: number } | null = null;
let inFlight: { converterUrl: string; promise: Promise<boolean> } | null = null;

/** Forget the cached answer — for tests, and after reconfiguring the converter. */
export function resetDoclingReachability(): void {
    cached = null;
    inFlight = null;
}

async function probeConverter(url: string, apiKey: string): Promise<boolean> {
    try {
        const response = await fetch(`${url}/capabilities`, {
            headers: { "X-API-Key": apiKey },
            signal: AbortSignal.timeout(CAPABILITIES_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { docling?: unknown };
        return body.docling === "ok";
    } catch {
        return false;
    }
}

/**
 * True only when services/document-converter says docling-serve is
 * answering. No converter, an older converter without /capabilities, or a
 * docling-serve that is down all read as false: Docling then drops out of the
 * order instead of failing the job with a 503.
 */
export async function isDoclingReachable(): Promise<boolean> {
    const converter = getOcrConfig().converter;
    if (!converter?.url) return false;
    const converterUrl = converter.url.replace(/\/+$/, "");

    if (cached?.converterUrl === converterUrl) {
        const ttl = cached.reachable ? OK_TTL_MS : FAIL_TTL_MS;
        if (Date.now() - cached.at < ttl) return cached.reachable;
    }
    if (inFlight?.converterUrl === converterUrl) return inFlight.promise;

    const promise = probeConverter(converterUrl, converter.apiKey).then(reachable => {
        cached = { converterUrl, reachable, at: Date.now() };
        if (inFlight?.promise === promise) inFlight = null;
        return reachable;
    });
    inFlight = { converterUrl, promise };
    return promise;
}

/** Which engines can run right now, asking the converter about Docling. */
export async function ocrAvailability(): Promise<OcrAvailability> {
    const cfg = getOcrConfig();
    const doclingReachable = cfg.converter?.url ? await isDoclingReachable() : false;
    return configuredOcrAvailability(cfg, doclingReachable);
}

/** Engines that can run right now, in the order they are tried. */
export async function availableOcrEngines(): Promise<OcrEngine[]> {
    return orderOcrEngines(await ocrAvailability());
}
