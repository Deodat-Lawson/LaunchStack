/**
 * Vision classification of sampled document pages.
 *
 * Backend priority (ported from ocr-router, now config-driven):
 *   1. Hosted OpenAI-compatible endpoint when any credential is present.
 *      Endpoint and credential are chosen as a PAIR: an operator who names
 *      AI_BASE_URL supplies its key (AI_API_KEY, falling back to
 *      OPENAI_API_KEY); when nobody names one we default to Gemini and only
 *      GOOGLE_AI_API_KEY travels there — forwarding an `sk-…` key would hand
 *      an OpenAI credential to a service it does not belong to.
 *   2. Local SigLIP zero-shot classification via @huggingface/transformers
 *      (WASM fallback, downloads the model on first use).
 *
 * The classifier's score is a real model measurement — the ONLY score the
 * routing surface ever reports (as `signals.visionScore`).
 */
import type { Config } from "./config.js";
import type { FetchLike } from "./fetch.js";
import { errorMessage } from "./errors.js";
import { log } from "./logger.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
const SIGLIP_MODEL_ID = "google/siglip-base-patch16-224";

/**
 * Heuristic ROUTING threshold on the vision score. Named so it can never be
 * mistaken for extraction confidence (ADR-004).
 */
export const COMPLEXITY_SCORE_THRESHOLD = 0.6;

export const COMPLEX_LABELS: string[] = [
    "handwritten notes",
    "messy scanned document",
    "receipt or invoice",
    "complex table structure",
];

export const SIMPLE_LABELS: string[] = ["digital text document", "clean screenshot", "blank page"];

const ALL_COMPLEXITY_LABELS = [...COMPLEX_LABELS, ...SIMPLE_LABELS];

export interface VisionClassification {
    label: string;
    score: number;
}

export type VisionClassifier = (images: Uint8Array[]) => Promise<VisionClassification>;

const OPENAI_CLASSIFY_PROMPT = `You are a document classifier. Analyze this image of a document page and classify it into EXACTLY ONE of these categories:

- "handwritten notes" — handwriting, pen/pencil marks
- "messy scanned document" — skewed, blurry, noisy scan
- "receipt or invoice" — receipts, invoices, financial forms
- "complex table structure" — dense tables, spreadsheet-like layouts
- "digital text document" — clean digital text, typed content
- "clean screenshot" — screenshot of a screen or app
- "blank page" — mostly empty

Respond with ONLY a JSON object: {"label": "<category>", "score": <confidence 0-1>}`;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

async function classifyHosted(
    config: Config,
    fetchImpl: FetchLike,
    images: Uint8Array[]
): Promise<VisionClassification> {
    const { baseUrl: rawBaseUrl, apiKey } = config.aiBaseUrl
        ? {
              baseUrl: config.aiBaseUrl,
              apiKey: config.aiApiKey ?? config.openaiApiKey ?? "",
          }
        : {
              baseUrl: GEMINI_BASE_URL,
              apiKey: config.googleAiApiKey ?? "",
          };
    // Stripped because the value is concatenated raw below.
    const baseUrl = rawBaseUrl.replace(/\/$/, "");
    const model = config.visionModel ?? GEMINI_DEFAULT_MODEL;

    log("info", "vision: hosted classification", { model });

    let dominantLabel = "digital text document";
    let score = 0;

    // Classify first image only (cost-effective — representative sample).
    const image = images[0];
    if (!image) return { label: dominantLabel, score };

    const b64 = Buffer.from(image).toString("base64");

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
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
                            image_url: {
                                url: `data:image/png;base64,${b64}`,
                                detail: "low",
                            },
                        },
                    ],
                },
            ],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`hosted vision failed (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content ?? "";

    try {
        // Parse JSON from the response (handle markdown code fences).
        const jsonStr = content
            .replace(/```json?\n?/g, "")
            .replace(/```/g, "")
            .trim();
        const parsed = JSON.parse(jsonStr) as { label: string; score: number };
        if (ALL_COMPLEXITY_LABELS.includes(parsed.label)) {
            dominantLabel = parsed.label;
            score = clamp01(parsed.score);
        }
    } catch {
        log("warn", "vision: failed to parse hosted response", { content });
    }

    return { label: dominantLabel, score };
}

async function classifySigLip(images: Uint8Array[]): Promise<VisionClassification> {
    log("info", "vision: local SigLIP classification (WASM)", {
        model: SIGLIP_MODEL_ID,
    });
    const { pipeline } = await import("@huggingface/transformers");

    const classifier = (await pipeline(
        "zero-shot-image-classification",
        SIGLIP_MODEL_ID
    )) as unknown as (
        image: unknown,
        labels: string[]
    ) => Promise<Array<{ label: string; score: number }>>;

    let maxComplexityScore = 0;
    let dominantLabel = "digital text document";

    for (const image of images) {
        const result = await classifier(image, ALL_COMPLEXITY_LABELS);
        const topMatch = result[0];
        if (topMatch && COMPLEX_LABELS.includes(topMatch.label)) {
            if (topMatch.score > maxComplexityScore) {
                maxComplexityScore = topMatch.score;
                dominantLabel = topMatch.label;
            }
        }
    }

    if (maxComplexityScore === 0 && images.length > 0) {
        const result = await classifier(images[0], ALL_COMPLEXITY_LABELS);
        const firstResult = result[0];
        if (firstResult) {
            return { label: firstResult.label, score: clamp01(firstResult.score) };
        }
    }

    return { label: dominantLabel, score: clamp01(maxComplexityScore) };
}

/**
 * Build the default classifier: hosted first when a credential exists,
 * SigLIP fallback. Injectable — tests replace it entirely.
 */
export function createVisionClassifier(config: Config, fetchImpl: FetchLike): VisionClassifier {
    return async images => {
        const hasHostedCredential = Boolean(
            config.googleAiApiKey ?? config.aiApiKey ?? config.openaiApiKey
        );
        if (hasHostedCredential) {
            try {
                return await classifyHosted(config, fetchImpl, images);
            } catch (err) {
                log("warn", "vision: hosted failed, falling back to SigLIP", {
                    message: errorMessage(err),
                });
            }
        }
        return classifySigLip(images);
    };
}
