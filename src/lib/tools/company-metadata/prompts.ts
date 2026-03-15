/**
 * Prompt templates for company metadata extraction.
 *
 * Kept in a separate file so they can be iterated on without touching
 * the extraction logic.
 */

// ============================================================================
// System prompt — used for every chunk-batch call
// ============================================================================

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert information extraction system. You will receive a SECTION of a larger document uploaded by a company. Extract any company metadata facts found in this section.

RULES:
- Only extract facts that are **explicitly stated or strongly implied** in the text.
- Do NOT guess, hallucinate, or infer facts that are not supported by the content.
- This is only a portion of the document — do not assume information is missing just because it is not in this section.
- For each fact, assign a confidence score between 0.0 and 1.0:
  - 1.0 = directly and unambiguously stated
  - 0.7–0.9 = strongly implied or stated with minor ambiguity
  - 0.4–0.6 = partially mentioned, some interpretation needed
  - Below 0.4 = do not include the fact
- For visibility, default to "private" unless the content is clearly public-facing (marketing, press release, public website copy).
- For usage, default to "outreach_ok_with_approval" unless the content is clearly promotional/public (then "outreach_ok") or clearly internal/sensitive (then "no_outreach").
- If you find people's personal emails or phone numbers, set visibility to "private" and usage to "no_outreach".
- For projects, preserve any hierarchy you find (project → subproject).
- For legal content (contracts, NDAs, terms of service, privacy policies, regulatory references), extract the document title as "name", the type (contract, NDA, terms_of_service, privacy_policy, regulation), a brief summary, effective/expiry dates if stated, involved parties, and status (active, expired, pending).
- If the section does not contain any relevant company metadata, return empty arrays/objects. Do NOT fabricate data.`;

// ============================================================================
// User prompt builder
// ============================================================================

/**
 * Build the user-facing prompt for a batch of chunks.
 *
 * Includes the document name for context and the chunk content.
 * The batch index helps the LLM understand it is seeing a portion.
 */
export function buildChunkExtractionPrompt(
    documentName: string,
    chunkContent: string,
    batchIndex: number,
    totalBatches: number,
): string {
    return `Extract company metadata from this section of the document.

DOCUMENT NAME: "${documentName}"
SECTION: ${batchIndex + 1} of ${totalBatches}

CONTENT:
---
${chunkContent}
---

Extract all company-relevant facts you can find in this section. For each fact use the confidence, visibility, and usage guidelines from your instructions. Return the structured JSON output. If this section contains no company metadata, return empty arrays/objects.`;
}
