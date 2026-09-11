/**
 * Prompt templates for company metadata extraction.
 *
 * Kept in a separate file so they can be iterated on without touching
 * the extraction logic.
 */
export declare const EXTRACTION_SYSTEM_PROMPT = "You are an expert information extraction system. You will receive a SECTION of a larger document uploaded by a company. Extract any company metadata facts found in this section.\n\nRULES:\n- Only extract facts that are **explicitly stated or strongly implied** in the text.\n- Do NOT guess, hallucinate, or infer facts that are not supported by the content.\n- This is only a portion of the document \u2014 do not assume information is missing just because it is not in this section.\n- For each fact, assign a confidence score between 0.0 and 1.0:\n  - 1.0 = directly and unambiguously stated\n  - 0.7\u20130.9 = strongly implied or stated with minor ambiguity\n  - 0.4\u20130.6 = partially mentioned, some interpretation needed\n  - Below 0.4 = do not include the fact\n- For visibility, default to \"private\" unless the content is clearly public-facing (marketing, press release, public website copy).\n- For usage, default to \"outreach_ok_with_approval\" unless the content is clearly promotional/public (then \"outreach_ok\") or clearly internal/sensitive (then \"no_outreach\").\n- If you find people's personal emails or phone numbers, set visibility to \"private\" and usage to \"no_outreach\".\n- For projects, preserve any hierarchy you find (project \u2192 subproject).\n- For legal content (contracts, NDAs, terms of service, privacy policies, regulatory references), extract the document title as \"name\", the type (contract, NDA, terms_of_service, privacy_policy, regulation), a brief summary, effective/expiry dates if stated, involved parties, and status (active, expired, pending).\n- If the section does not contain any relevant company metadata, return empty arrays/objects. Do NOT fabricate data.";
/**
 * Build the user-facing prompt for a batch of chunks.
 *
 * Includes the document name for context and the chunk content.
 * The batch index helps the LLM understand it is seeing a portion.
 */
export declare function buildChunkExtractionPrompt(documentName: string, chunkContent: string, batchIndex: number, totalBatches: number): string;
//# sourceMappingURL=prompts.d.ts.map