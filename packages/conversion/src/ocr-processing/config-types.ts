/**
 * The `ocr` slice of the engine config — owned by conversion, referenced by
 * the aggregate CoreConfig in @launchstack/engine.
 */
export type OcrProviderName = "DOCLING" | "NATIVE_PDF" | "AZURE" | "LANDING_AI" | "DATALAB";

/**
 * How a PDF is read. "text-layer-first" (the default) uses the PDF's own text
 * when it has one and sends only scans to OCR. "provider-first" sends every
 * PDF to `defaultProvider` and reads the text layer only when that provider
 * fails.
 */
export type OcrPdfStrategy = "text-layer-first" | "provider-first";

/**
 * Azure Document Intelligence model. "prebuilt-layout" (the default) returns
 * text, reading order, and tables; "prebuilt-read" returns text only and
 * costs roughly a seventh as much per page.
 */
export type AzureDocumentModel = "prebuilt-layout" | "prebuilt-read";

export interface OcrConfig {
    /** Local-fallback provider pin; the converter honors its own OCR_DEFAULT_PROVIDER. */
    defaultProvider?: OcrProviderName;
    /** OCR_PDF_STRATEGY; unset means "text-layer-first". */
    pdfStrategy?: OcrPdfStrategy;
    /** Absolute origin of the app — needed by the converter to fetch /api/files/ URLs. */
    appPublicUrl?: string;
    /**
     * Secret used to sign short-lived tokens on worker-bound /api/files/ URLs.
     * Without it the worker cannot read database-backed documents, because that
     * route requires a Clerk session and the worker has none.
     */
    fileAccessTokenSecret?: string;
    /** Model identifier for the vision classifier (converter reads its own copy). */
    visionModel?: string;
    /** Adapter-specific credentials. Each is optional; adapters no-op if missing. */
    datalabApiKey?: string;
    azure?: { endpoint: string; key: string; model?: AzureDocumentModel };
    landingAi?: { apiKey: string };
    /**
     * services/document-converter (ADR-004): the consolidated routing, vision
     * classification, PDF page rendering, and docling parsing service. Every
     * endpoint authenticates X-API-Key and fails closed — an empty apiKey means
     * every call returns 401.
     */
    converter?: { url: string; apiKey: string };
    /**
     * @deprecated The ocr-worker service was removed by ADR-004 (consolidated
     * into services/document-converter). Ignored at runtime with a startup
     * warning — configure `converter` instead.
     */
    workerUrl?: string;
    /**
     * @deprecated The ocr-router service was removed by ADR-004 (consolidated
     * into services/document-converter). Ignored at runtime with a startup
     * warning — configure `converter` instead.
     */
    routerUrl?: string;
    /**
     * @deprecated Vision credentials are no longer forwarded per-request: the
     * removed ocr-router accepted them in an `env` map (ADR-004); the
     * document-converter reads its own vision configuration at startup. Ignored
     * at runtime with a startup warning.
     */
    vision?: {
        googleApiKey?: string;
        openaiApiKey?: string;
        aiApiKey?: string;
        aiBaseUrl?: string;
    };
}
