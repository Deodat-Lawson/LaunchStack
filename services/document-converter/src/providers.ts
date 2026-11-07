/**
 * Which OCR provider reads a document — one order for every path.
 *
 *   1. OCR_DEFAULT_PROVIDER, when an operator pinned one and it can run here
 *   2. AZURE — Document Intelligence, when its endpoint and key are set
 *   3. DOCLING — only when docling-serve answers its health check, not merely
 *      because DOCLING_SERVE_URL is set (Compose always sets it, profile or not)
 *   4. LANDING_AI
 *   5. DATALAB
 *   → NATIVE_PDF, the PDF's own text layer, when none of them can run.
 *
 * Simple and complex documents use the same order: the old split chains
 * (Docling-first, a complex chain that ignored the operator pin) routed scans
 * to a docling-serve that was not running and failed the job.
 *
 * The app keeps the same list in
 * packages/conversion/src/ocr-processing/provider-order.ts (this service lives
 * outside the pnpm workspace, so it cannot import it); a test on each side
 * pins the order.
 */
import type { Config, OcrProvider } from "./config.js";
import type { DoclingHealth } from "./docling.js";

/** OCR engines in preference order, before the operator pin is applied. */
export const OCR_PROVIDER_ORDER = ["AZURE", "DOCLING", "LANDING_AI", "DATALAB"] as const;
export type OcrEngine = (typeof OCR_PROVIDER_ORDER)[number];

export type DoclingState = "ok" | "not-configured" | "unreachable";

function isConfigured(config: Config, provider: OcrEngine, doclingReachable: boolean): boolean {
    switch (provider) {
        case "AZURE":
            return Boolean(config.azureEndpoint && config.azureKey);
        case "DOCLING":
            return Boolean(config.doclingServeUrl) && doclingReachable;
        case "LANDING_AI":
            return Boolean(config.landingAiApiKey);
        case "DATALAB":
            return Boolean(config.datalabApiKey);
    }
}

/** Every OCR engine that can run right now, in the order they are tried. */
export function ocrProviderOrder(config: Config, doclingReachable: boolean): OcrEngine[] {
    const available = OCR_PROVIDER_ORDER.filter(provider =>
        isConfigured(config, provider, doclingReachable)
    );
    const pin = config.defaultProvider;
    if (pin && pin !== "NATIVE_PDF" && available.includes(pin)) {
        return [pin, ...available.filter(provider => provider !== pin)];
    }
    return available;
}

/**
 * The provider for a document nobody chose one for: the first OCR engine in
 * the order, or the text layer when none can run. An operator who pinned
 * NATIVE_PDF gets the text layer unless OCR is forced.
 */
export function defaultProvider(config: Config, doclingReachable: boolean): OcrProvider {
    if (config.defaultProvider === "NATIVE_PDF") return "NATIVE_PDF";
    return ocrProviderOrder(config, doclingReachable)[0] ?? "NATIVE_PDF";
}

/** forceOCR: the first OCR engine, ignoring a NATIVE_PDF pin; the text layer only when none can run. */
export function forcedOcrProvider(config: Config, doclingReachable: boolean): OcrProvider {
    return ocrProviderOrder(config, doclingReachable)[0] ?? "NATIVE_PDF";
}

export interface DoclingProbeOptions {
    /** How long a healthy answer is trusted. */
    okTtlMs?: number;
    /** How long an unreachable answer is trusted before probing again. */
    failTtlMs?: number;
}

/**
 * docling-serve's health, cached so routing never waits on it more than once
 * per TTL. Concurrent callers share one in-flight probe.
 */
export function createDoclingProbe(
    config: Config,
    health: DoclingHealth,
    options: DoclingProbeOptions = {}
): () => Promise<DoclingState> {
    const okTtlMs = options.okTtlMs ?? 10_000;
    const failTtlMs = options.failTtlMs ?? 15_000;
    let cached: { state: DoclingState; at: number } | null = null;
    let inFlight: Promise<DoclingState> | null = null;

    return async () => {
        if (!config.doclingServeUrl) return "not-configured";
        if (cached) {
            const ttl = cached.state === "ok" ? okTtlMs : failTtlMs;
            if (Date.now() - cached.at < ttl) return cached.state;
        }
        inFlight ??= (async (): Promise<DoclingState> => {
            let state: DoclingState = "unreachable";
            try {
                state = (await health(config)) ? "ok" : "unreachable";
            } catch {
                state = "unreachable";
            }
            cached = { state, at: Date.now() };
            return state;
        })().finally(() => {
            inFlight = null;
        });
        return inFlight;
    };
}
