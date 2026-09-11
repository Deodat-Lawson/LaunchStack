/** Versioned prompts for the company-context tool. Bump on any wording change. */

export const COMPANY_CONTEXT_PROMPT_VERSION = "2026-08-22.1";

export const DNA_SYSTEM_PROMPT = `You are a strategist. Given company information, distill it into a structured CompanyDNA.
Rules:
- Use ONLY information present in the input. Do not invent.
- If something is missing, use a short placeholder like "Not specified" or an empty array.
- coreMission: one sentence on what the company does and for whom.
- keyDifferentiators: 2-5 short phrases (e.g. "open source", "no vendor lock-in").
- provenResults: metrics, outcomes, awards, case results mentioned.
- humanStory: founding story, team ethos, or values if present; otherwise "Not specified".
- technicalEdge: one simple sentence on how it works or why it's better; keep it non-technical.
Return valid JSON matching the schema.`;
