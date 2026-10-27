/**
 * What leaves this deployment — computed from the environment, never from a
 * claim. A credential is never read here, let alone returned.
 * AI capabilities report a category, not a host: the screen never names the
 * model vendor (see {@link aiProvider}).
 *
 * This is the one place the answer to "which outside service sees my
 * document text" is written down, so it is deliberately derived from the
 * same variables the capabilities read rather than from a hand-maintained
 * list that would drift.
 */

import { env } from "~/env";
import { getDeploymentMode } from "~/server/deployment";
import { resolveChatEndpoint } from "~/server/chat-endpoint";

export type Exposure = "document-text" | "metadata" | "none";

export interface OutboundService {
    id: string;
    label: string;
    /** Hostname the capability talks to, or null when it is off / local. */
    host: string | null;
    /** What that host receives. */
    sends: Exposure;
    /** Whether the capability is configured at all. */
    enabled: boolean;
    /** In English, for API callers; the page words `ocr` in the reader's language. */
    note: string;
    /** OCR only: which PDFs are read with OCR, and the engines in the order tried. */
    ocr?: OcrPlan;
}

export type OcrEngineId = (typeof OCR_SERVICES)[number]["id"];

export interface OcrPlan {
    /**
     * Which PDFs reach OCR: `none` (no engine configured), `all` (the
     * default), `scans` (OCR_PDF_STRATEGY=text-layer-first) or `picked`
     * (OCR_DEFAULT_PROVIDER=NATIVE_PDF: only PDFs someone picks a provider for).
     */
    scope: "none" | "all" | "scans" | "picked";
    /** Configured engines, an operator pin first. Docling runs on this deployment. */
    order: OcrEngineId[];
}

export interface PrivacyOverview {
    deploymentMode: "self-hosted" | "cloud";
    /** Vercel Analytics is mounted only on the hosted product. */
    productAnalytics: boolean;
    services: OutboundService[];
}

function hostOf(url: string | null | undefined): string | null {
    const trimmed = url?.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed).host;
    } catch {
        return trimmed;
    }
}

const GEMINI_HOST = "generativelanguage.googleapis.com";

/**
 * An AI capability as the page shows it: whether it is on, and that its text
 * goes to an outside model provider — not which one. The host is still worked
 * out above, because "is it configured" depends on it.
 */
function aiProvider(service: OutboundService): OutboundService {
    if (!service.host) return service;
    return {
        ...service,
        host: null,
        note: `${isLocalHost(service.host) ? "Runs on this deployment's own servers." : "Sent to a third-party AI model provider."} ${service.note}`,
    };
}

/**
 * A host that never leaves the deployment: the transcription sidecar, a
 * Compose service name (`transcription:8000`, `ollama:11434`), loopback, or a
 * private-network name. Anything with a public domain counts as outside.
 */
function isLocalHost(host: string): boolean {
    const name = host
        .replace(/:\d+$/, "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
    return (
        name === "sidecar" ||
        !name.includes(".") ||
        name === "::1" ||
        name.startsWith("127.") ||
        name.startsWith("10.") ||
        name.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(name) ||
        name.endsWith(".local") ||
        name.endsWith(".internal")
    );
}

/** Outside OCR services, in the order ingestion tries them (see provider-order.ts). */
const OCR_SERVICES = [
    { id: "AZURE", name: "Azure Document Intelligence" },
    { id: "DOCLING", name: "Docling" },
    { id: "LANDING_AI", name: "Landing AI" },
    { id: "DATALAB", name: "Datalab" },
] as const;

/**
 * Where PDFs and images go to be read: the configured OCR services in the
 * pipeline's order (an operator pin first), from the same variables the
 * adapters read, and which PDFs reach them (every one by default; only scans
 * under OCR_PDF_STRATEGY=text-layer-first). Docling runs on this deployment
 * (docling-serve behind the document converter), so it never counts as
 * leaving it.
 */
function ocrDisclosure(server: typeof env.server): {
    host: string | null;
    local: boolean;
    note: string;
    plan: OcrPlan;
} {
    const outside: Record<string, string | null> = {
        AZURE:
            server.AZURE_DOC_INTELLIGENCE_ENDPOINT && server.AZURE_DOC_INTELLIGENCE_KEY
                ? hostOf(server.AZURE_DOC_INTELLIGENCE_ENDPOINT)
                : null,
        LANDING_AI: server.LANDING_AI_API_KEY ? "api.va.landing.ai" : null,
        DATALAB: server.DATALAB_API_KEY ? "www.datalab.to" : null,
    };
    const hasConverter = Boolean(server.DOCUMENT_CONVERTER_URL ?? server.OCR_ROUTER_URL);
    const pin = server.OCR_DEFAULT_PROVIDER;
    const configured = OCR_SERVICES.filter(service =>
        service.id === "DOCLING" ? hasConverter : Boolean(outside[service.id])
    );
    const ordered = [
        ...configured.filter(service => service.id === pin),
        ...configured.filter(service => service.id !== pin),
    ];
    const first = ordered.find(service => service.id !== "DOCLING");
    const host = first ? (outside[first.id] ?? null) : null;

    if (ordered.length === 0) {
        return {
            host: null,
            local: false,
            plan: { scope: "none", order: [] },
            note: "No OCR service is configured: PDFs are read from their own text layer and images with Tesseract, both on this server. Nothing leaves it, and scanned pages come out blank.",
        };
    }

    const named = ordered.map(service =>
        service.id === "DOCLING"
            ? "Docling on this deployment (when docling-serve is running)"
            : service.name
    );
    const [lead, ...rest] = named;
    const chain = `${lead} reads every page${rest.length > 0 ? `; ${rest.join(", then ")} if it fails` : ""}`;
    // OCR_PDF_STRATEGY=text-layer-first opts out of provider-first, the default.
    const textLayerFirst = server.OCR_PDF_STRATEGY === "text-layer-first" && pin !== "NATIVE_PDF";
    const scope =
        pin === "NATIVE_PDF"
            ? "Images, and PDFs someone picks a provider for, are read with OCR (this deployment defaults PDFs to their text layer)."
            : textLayerFirst
              ? "Images and scanned PDFs are read with OCR; a PDF with its own text layer is read from it on this server."
              : "Every PDF and image is read with OCR.";
    const last = textLayerFirst
        ? "a scan none of them can read is retried, not indexed blank."
        : "the PDF's own text layer is the last resort, and a scan none of them can read is retried, not indexed blank.";
    const plan: OcrPlan = {
        scope: pin === "NATIVE_PDF" ? "picked" : textLayerFirst ? "scans" : "all",
        order: ordered.map(service => service.id),
    };
    return { host, local: !host, note: `${scope} ${chain}; ${last}`, plan };
}

export function privacyOverview(): PrivacyOverview {
    const server = env.server;
    const chat = hostOf(resolveChatEndpoint(server).baseUrl);
    const fallbackAi = hostOf(server.AI_BASE_URL);

    const embeddingHost =
        hostOf(server.EMBEDDING_API_BASE_URL) ??
        fallbackAi ??
        (server.OPENAI_API_KEY ? "api.openai.com" : null);
    const rerankHost = hostOf(server.RERANK_API_BASE_URL) ?? fallbackAi ?? GEMINI_HOST;
    const nerHost = hostOf(server.NER_API_BASE_URL) ?? fallbackAi ?? GEMINI_HOST;
    const transcriptionHost =
        server.TRANSCRIPTION_PROVIDER === "sidecar"
            ? (hostOf(server.TRANSCRIPTION_SERVICE_URL) ?? "sidecar")
            : (hostOf(server.TRANSCRIPTION_API_BASE_URL) ?? GEMINI_HOST);
    const ocr = ocrDisclosure(server);

    const services: OutboundService[] = [
        aiProvider({
            id: "chat",
            label: "Chat and generation",
            host: chat,
            sends: "document-text",
            enabled: Boolean(chat),
            note: "Every question, the passages retrieved to answer it, and every generated document go here.",
        }),
        aiProvider({
            id: "embedding",
            label: "Embeddings",
            host: embeddingHost,
            sends: "document-text",
            enabled: Boolean(embeddingHost),
            note: "Every chunk of every indexed document is sent to be embedded. A workspace that saved its own embedding key or endpoint earlier keeps using it instead.",
        }),
        aiProvider({
            id: "rerank",
            label: "Reranking",
            host: rerankHost,
            sends: "document-text",
            enabled: true,
            note: "Candidate passages for a question are sent to be reordered.",
        }),
        aiProvider({
            id: "ner",
            label: "Entity extraction",
            host: nerHost,
            sends: "document-text",
            enabled: true,
            note: "Runs only when entity extraction is turned on for a document.",
        }),
        {
            id: "ocr",
            label: "OCR",
            host: ocr.host,
            sends: ocr.host ? "document-text" : "none",
            enabled: ocr.host !== null || ocr.local,
            note: ocr.note,
            ocr: ocr.plan,
        },
        aiProvider({
            id: "transcription",
            label: "Transcription",
            host: transcriptionHost,
            sends: "document-text",
            enabled: true,
            note: "Uploaded audio and video are transcribed here.",
        }),
        {
            id: "email",
            label: "Outbound email",
            host: server.EMAIL_SENDING_ENABLED === "true" ? "configured" : null,
            sends: "metadata",
            enabled: server.EMAIL_SENDING_ENABLED === "true",
            note: "Invitations, password resets and approved campaigns. Never document text.",
        },
        {
            id: "slack",
            label: "Slack",
            host: server.SLACK_BOT_TOKEN ? "slack.com" : null,
            sends: "document-text",
            enabled: Boolean(server.SLACK_BOT_TOKEN),
            note: "Only meetings that mirror to a channel; the agents' turns are posted there.",
        },
        {
            id: "drive",
            label: "Google Drive",
            host: server.GOOGLE_DOCS_EDITING_ENABLED === "true" ? "www.googleapis.com" : null,
            sends: "document-text",
            enabled: server.GOOGLE_DOCS_EDITING_ENABLED === "true",
            note: "Only files someone links or creates in Drive; synced back as versions.",
        },
        {
            id: "notion",
            label: "Notion",
            host:
                server.NOTION_OAUTH_CLIENT_ID && server.NOTION_OAUTH_CLIENT_SECRET
                    ? "api.notion.com"
                    : null,
            sends: "metadata",
            enabled: Boolean(server.NOTION_OAUTH_CLIENT_ID && server.NOTION_OAUTH_CLIENT_SECRET),
            note: "Reads only the pages picked on Notion's consent screen. Nothing is written to Notion.",
        },
        {
            id: "sec-edgar",
            label: "Investor search",
            host: "efts.sec.gov",
            sends: "metadata",
            enabled: true,
            note: "Only the words and state typed into Find investors. Never document text.",
        },
    ];

    return {
        deploymentMode: getDeploymentMode(),
        productAnalytics: getDeploymentMode() === "cloud" || process.env.VERCEL === "1",
        services,
    };
}
