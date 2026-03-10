import OpenAI from "openai";

/**
 * Visual Layout Model (VLM) Enrichment Service
 * Uses OpenAI GPT-4o to analyze document pages visually and extract semantic meaning
 * from charts, diagrams, and complex layouts.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Configuration for VLM enrichment
 */
export interface VlmEnrichmentOptions {
  model?: string;
  detail?: "low" | "high" | "auto";
  maxTokens?: number;
}

/**
 * Enrich a page image with VLM-generated description
 */
export async function enrichPageWithVlm(
  imageBuffer: Buffer,
  options?: VlmEnrichmentOptions
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[VLM] OPENAI_API_KEY not found, skipping enrichment");
    return "";
  }

  const model = options?.model ?? "gpt-4o";
  const detail = options?.detail ?? "auto";
  const maxTokens = options?.maxTokens ?? 500;

  try {
    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a document analysis assistant. Your job is to analyze the visual layout of a document page and describe its key components, especially those that OCR might miss.
          
Focus on:
1. Charts and graphs: Describe the type, axes, trends, and key data points.
2. Diagrams and flowcharts: Explain the relationships and process flow.
3. Images/Photos: Briefly describe the subject.
4. Complex layouts: Explain how information is structured (e.g., sidebars, callouts).
5. Handwritten notes: Transcribe or summarize them if they seem important.

Do NOT repeat plain text that is clearly legible. Focus on the VISUAL and STRUCTURAL elements.
Keep the description concise and factual.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this document page and provide a visual description of charts, diagrams, or complex layout elements.",
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
                detail,
              },
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    });

    const description = response.choices[0]?.message?.content ?? "";
    return description.trim();
  } catch (error) {
    console.error("[VLM] Enrichment failed:", error);
    return "";
  }
}
