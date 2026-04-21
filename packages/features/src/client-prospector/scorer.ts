// Lead scorer for the Client Prospector pipeline.
//
// Takes raw place results from Foursquare and uses an LLM to select,
// score, and rank up to 10 businesses as potential client prospects.
// Each result gets a relevanceScore (0-100) and a rationale explaining
// why it's a good prospect for the user's company.

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ProspectResult, RawPlaceResult } from "./types";

// ─── Structured output schema for LLM ───────────────────────────────────────

const ScoredProspectSchema = z.object({
    fsqId: z.string().min(1).describe("The Foursquare ID of the business (must match one from the input)"),
    name: z.string().min(1).describe("The exact business name as shown in the input list"),
    relevanceScore: z.number().int().min(0).max(100).describe("Relevance score from 0-100"),
    rationale: z.string().min(1).describe("Why this business is a good prospect for the user's company"),
});

const ScorerOutputSchema = z.object({
    prospects: z
        .array(ScoredProspectSchema)
        .max(10)
        .describe("Up to 10 scored prospects, ranked by relevanceScore descending"),
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a lead scoring assistant for a client prospecting tool.

CONTEXT: The user's company is looking for POTENTIAL CLIENTS — businesses they can sell their services to. These businesses are the BUYERS, and the user's company is the SELLER.

Given a list of businesses found near a location, the user's prospecting query, and their company context, your job is to:

1. Select up to 10 businesses that are the BEST potential clients for the user's company.
2. Assign each a relevanceScore from 0 to 100 based on how likely the business is to NEED the user's services.
3. Rank them by relevanceScore descending (highest first).
4. Write a brief rationale for each explaining why it would be a good client.

SCORING GUIDANCE:
- HIGH scores (70-100): Businesses that clearly match the target client profile and would likely benefit from the user's services.
- MEDIUM scores (40-69): Businesses that could plausibly be clients but are a weaker fit.
- LOW scores (0-39): Businesses that are unlikely to need the user's services, or are COMPETITORS of the user's company (same industry/service type). Competitors should score very low.
- Example: If the user is a "digital marketing agency", other marketing agencies are COMPETITORS, not prospects. Restaurants, cafes, and retail shops are the PROSPECTS.

RULES:
- Only select businesses from the provided list.
- Each business may appear AT MOST ONCE in your output. NEVER repeat the same fsqId.
- For each selected business, copy its fsqId AND name EXACTLY as shown in the input.
- fsqIds are long hex strings like "50981188e4b0f94e062c8664". Do NOT truncate, abbreviate, or modify them.
- The rationale MUST describe the actual business whose fsqId and name you copied — do NOT mix up descriptions between businesses.
- If fewer than 10 businesses are provided, score all of them (do not pad with fake entries).
- Consider business category, name, description, and location when scoring.`;

function buildHumanPrompt(
    rawPlaces: RawPlaceResult[],
    query: string,
    companyContext: string,
    categories: string[],
): string {
    const placesBlock = rawPlaces
        .map(
            (p) =>
                `- fsqId: "${p.fsqId}"\n  Name: ${p.name}\n  Address: ${p.formattedAddress || p.address}\n  Categories: ${p.categories.map((c) => c.name).join(", ")}\n  Description: ${p.description ?? "N/A"}\n  Website: ${p.website ?? "N/A"}`,
        )
        .join("\n\n");

    const categoryBlock =
        categories.length > 0
            ? `Target categories: ${categories.join(", ")}`
            : "No specific category filter.";

    return `PROSPECTING QUERY: ${query}

COMPANY CONTEXT: ${companyContext}

${categoryBlock}

BUSINESSES FOUND (copy fsqId strings exactly as quoted):
${placesBlock}

Select up to 10 best prospects. For each, copy the full fsqId string AND the exact business name as shown above. Each fsqId must appear only once. Score them 0-100, rank by score descending.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scores and ranks raw place results, returning up to 10 ProspectResults.
 *
 * - Uses an LLM to evaluate relevance to the user's query and company
 * - Each result gets a relevanceScore (0-100) and rationale
 * - Results are ranked by relevanceScore descending
 * - If fewer than 10 raw results, scores all available (no padding)
 * - Returns empty array if no raw places are provided
 */
export async function scoreLeads(
    rawPlaces: RawPlaceResult[],
    query: string,
    companyContext: string,
    categories: string[],
): Promise<ProspectResult[]> {
    if (rawPlaces.length === 0) {
        return [];
    }

    const chat = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.2,
        ...(process.env.AI_BASE_URL ? { configuration: { baseURL: process.env.AI_BASE_URL } } : {}),
    });

    const structuredModel = chat.withStructuredOutput(ScorerOutputSchema, {
        name: "scored_prospects",
    });

    const humanPrompt = buildHumanPrompt(rawPlaces, query, companyContext, categories);

    const response = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(humanPrompt),
    ]);

    // Build a lookup map for raw places by fsqId
    const placeMap = new Map(rawPlaces.map((p) => [p.fsqId, p]));

    // Map scored results back to full ProspectResult objects,
    // deduplicating by fsqId (keep first = highest-scored since LLM returns descending)
    const seenIds = new Set<string>();
    const results: ProspectResult[] = [];
    for (const scored of response.prospects) {
        // Skip duplicate fsqIds — LLM sometimes reuses the same ID with different rationales
        if (seenIds.has(scored.fsqId)) {
            console.warn(`[scorer] Duplicate fsqId in LLM output: ${scored.fsqId}, keeping first occurrence.`);
            continue;
        }

        const raw = placeMap.get(scored.fsqId);
        if (!raw) {
            // LLM hallucinated an fsqId — skip it
            console.warn(`[scorer] LLM returned unknown fsqId: ${scored.fsqId}, skipping.`);
            continue;
        }

        // Validate that the LLM's name matches the actual place — catches cross-contamination
        if (scored.name !== raw.name) {
            console.warn(
                `[scorer] Name mismatch for fsqId ${scored.fsqId}: LLM said "${scored.name}", actual is "${raw.name}". Using actual data; rationale may be inaccurate.`,
            );
        }

        seenIds.add(scored.fsqId);
        results.push({
            fsqId: raw.fsqId,
            name: raw.name,
            address: raw.formattedAddress || raw.address,
            location: raw.location,
            categories: raw.categories.map((c) => c.name),
            phone: raw.phone,
            website: raw.website,
            rating: raw.rating,
            relevanceScore: scored.relevanceScore,
            rationale: scored.rationale,
        });
    }

    // Ensure sorted by relevanceScore descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results.slice(0, 10);
}
