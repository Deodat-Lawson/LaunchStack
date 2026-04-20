import OpenAI from "openai";

/**
 * Visual Layout Model (VLM) Enrichment Service
 *
 * Analyzes document pages visually to extract semantic meaning from charts,
 * diagrams, and complex layouts that plain OCR may miss.
 *
 * Provider preference (first available wins):
 *   1. Ollama — if OLLAMA_BASE_URL is set. Uses OLLAMA_VLM_MODEL (default
 *      "llava:13b"). Zero cost, self-hosted.
 *   2. OpenAI — if OPENAI_API_KEY is set. Uses gpt-5-mini by default.
 *   3. Skip — return empty string.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "placeholder",
  ...(process.env.AI_BASE_URL ? { baseURL: process.env.AI_BASE_URL } : {}),
});

const SYSTEM_PROMPT = `You are a document analysis assistant. Your job is to analyze the visual layout of a document page and describe its key components, especially those that OCR might miss.

Focus on:
1. Charts and graphs: Describe the type, axes, trends, and key data points.
2. Diagrams and flowcharts: Explain the relationships and process flow.
3. Images/Photos: Briefly describe the subject.
4. Complex layouts: Explain how information is structured (e.g., sidebars, callouts).
5. Handwritten notes: Transcribe or summarize them if they seem important.

Do NOT repeat plain text that is clearly legible. Focus on the VISUAL and STRUCTURAL elements.
Keep the description concise and factual.`;

const USER_PROMPT =
  "Analyze this document page and provide a visual description of charts, diagrams, or complex layout elements.";

export interface VlmEnrichmentOptions {
  model?: string;
  detail?: "low" | "high" | "auto";
  maxTokens?: number;
}

export async function enrichPageWithVlm(
  imageBuffer: Buffer,
  options?: VlmEnrichmentOptions
): Promise<string> {
  if (process.env.OLLAMA_BASE_URL) {
    return enrichWithOllama(imageBuffer, options);
  }
  if (process.env.OPENAI_API_KEY) {
    return enrichWithOpenAI(imageBuffer, options);
  }
  console.warn("[VLM] No VLM provider configured (set OLLAMA_BASE_URL or OPENAI_API_KEY), skipping enrichment");
  return "";
}

async function enrichWithOllama(
  imageBuffer: Buffer,
  options?: VlmEnrichmentOptions
): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL!.replace(/\/$/, "");
  const model = options?.model ?? process.env.OLLAMA_VLM_MODEL ?? "llava:13b";
  const maxTokens = options?.maxTokens ?? 500;

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_predict: maxTokens },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: USER_PROMPT,
            images: [imageBuffer.toString("base64")],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[VLM] Ollama enrichment failed: ${response.status} ${body.slice(0, 300)}`);
      return "";
    }

    const data = (await response.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim();
  } catch (error) {
    console.error("[VLM] Ollama enrichment error:", error);
    return "";
  }
}

async function enrichWithOpenAI(
  imageBuffer: Buffer,
  options?: VlmEnrichmentOptions
): Promise<string> {
  const model = options?.model ?? "gpt-5-mini";
  const detail = options?.detail ?? "auto";
  const maxTokens = options?.maxTokens ?? 500;

  try {
    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail } },
          ],
        },
      ],
      max_tokens: maxTokens,
    });

    return (response.choices[0]?.message?.content ?? "").trim();
  } catch (error) {
    console.error("[VLM] OpenAI enrichment failed:", error);
    return "";
  }
}
