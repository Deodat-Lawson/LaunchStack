/**
 * What leaves this deployment — computed from the environment, never from a
 * claim. Hosts only: a credential is never read here, let alone returned.
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
    note: string;
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
    const ocrProvider = server.OCR_DEFAULT_PROVIDER ?? "DOCLING";
    const ocrHost =
        ocrProvider === "NATIVE_PDF"
            ? null
            : (hostOf(server.OCR_ROUTER_URL) ?? hostOf(server.OCR_WORKER_URL));

    const services: OutboundService[] = [
        {
            id: "chat",
            label: "Chat and generation",
            host: chat,
            sends: "document-text",
            enabled: Boolean(chat),
            note: "Every question, the passages retrieved to answer it, and every generated document go here.",
        },
        {
            id: "embedding",
            label: "Embeddings",
            host: embeddingHost,
            sends: "document-text",
            enabled: Boolean(embeddingHost),
            note: "Every chunk of every indexed document is sent to be embedded. Companies with their own key or an Ollama endpoint override this per workspace.",
        },
        {
            id: "rerank",
            label: "Reranking",
            host: rerankHost,
            sends: "document-text",
            enabled: true,
            note: "Candidate passages for a question are sent to be reordered.",
        },
        {
            id: "ner",
            label: "Entity extraction",
            host: nerHost,
            sends: "document-text",
            enabled: true,
            note: "Runs only when entity extraction is turned on for a document.",
        },
        {
            id: "ocr",
            label: "OCR",
            host: ocrHost,
            sends: ocrHost ? "document-text" : "none",
            enabled: Boolean(ocrHost),
            note: ocrHost
                ? `Scanned pages go to the ${ocrProvider.toLowerCase().replace("_", " ")} provider through the document converter.`
                : "Native PDF extraction only; nothing leaves the server.",
        },
        {
            id: "transcription",
            label: "Transcription",
            host: transcriptionHost,
            sends: "document-text",
            enabled: true,
            note: "Uploaded audio and video are transcribed here.",
        },
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
    ];

    return {
        deploymentMode: getDeploymentMode(),
        productAnalytics: getDeploymentMode() === "cloud" || process.env.VERCEL === "1",
        services,
    };
}
