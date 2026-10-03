/**
 * Prompts for the company profile, versioned. Changing a prompt or a rule
 * that decides what a source says is a reviewable edit here, and bumping
 * {@link READER_VERSION} makes the next build re-read every source.
 */

/** Stamped on every source row; a different value means "read it again". */
export const READER_VERSION = "profile-reader/2026-10-03.9";

// ============================================================================
// Sorting sources
// ============================================================================

export const TRIAGE_SYSTEM_PROMPT = `You decide whether a document in an organisation's workspace is about that organisation, so that a profile of the organisation is built only from documents that speak for it.

You are given the workspace's organisation name (it may be a person's or a placeholder name like "Timothy's workspace"), what is already known about the organisation, and the document's title, folder, kind, and opening passages (noise such as reference lists and number tables already removed).

Return one role:
- "about_us": written by the organisation, or about it, or it is a party to it — its own website, pitch deck, plans, reports, proposals, product docs, internal notes and meeting notes, policies, contracts it signed, press about it.
- "third_party": someone else's material kept for reference — research papers, articles, books, reports or documentation written by other people or organisations, other companies' sites or decks, templates — even when the topic is relevant to the organisation's work. A research paper counts as about_us only when its authors are affiliated with the organisation itself.
- "no_content": nothing to learn from — placeholder or test content, an empty or near-empty file, a scratch diagram with a few words.

Judge from who wrote it and whose voice it is in ("we", "our product"), its author list and affiliations, and what it describes — not just from whether the organisation's name appears. When the organisation name is a placeholder, rely on voice and content.

reason: one plain sentence for the organisation's staff saying what the document is and why it does or doesn't count, e.g. "A research paper by authors at the University of Washington and Tencent AI Lab — not about Acme." or "Acme's own pitch deck." Never more than 30 words.
subject: who or what the document is mainly about, in a few words.`;

export function buildTriagePrompt(input: {
    companyName: string;
    known: string[];
    title: string;
    folder: string;
    kind: string;
    opening: string;
}): string {
    return [
        `ORGANISATION: ${input.companyName}`,
        input.known.length ? `ALREADY KNOWN:\n${input.known.map(k => `- ${k}`).join("\n")}` : "",
        `DOCUMENT: "${input.title}" (folder: ${input.folder}; kind: ${input.kind})`,
        "",
        "OPENING PASSAGES:",
        "---",
        input.opening,
        "---",
    ]
        .filter(line => line !== "")
        .join("\n");
}

// ============================================================================
// Reading facts from a source
// ============================================================================

export const EXTRACTION_SYSTEM_PROMPT = `You extract facts about one organisation from numbered passages of a document that speaks for it (its own material, or material about it).

Extract facts about THAT organisation only. Passages also mention other people, organisations and works — cited papers, partners' own details, competitors, customers' addresses, places where events happened. Those are not facts about the organisation unless the passage states the relationship (e.g. "We partner with the City of Baltimore" makes the City a partner).

Every fact carries:
- quote: the exact words copied from ONE passage that state the fact — a full sentence or line, 6 to 40 words, copied character for character (keep the passage's spelling and numbers). A fact you cannot quote is not a fact: leave it out.
- passage: the [P#] number the quote is copied from.
- confidence 0.0–1.0: 1.0 stated outright; 0.7–0.9 stated with minor ambiguity; 0.4–0.6 needs interpretation; below 0.4 leave it out.
- visibility: "private" unless the text is clearly public-facing (website copy, press release, published deck) → "public".
- usage: "outreach_ok_with_approval" unless clearly promotional/public ("outreach_ok") or internal/sensitive ("no_outreach"). Personal emails and phone numbers: visibility "private", usage "no_outreach".

Return each fact as one statement in \`facts\`, with its section, field, subject and value:
- section "company", subject null, field one of: name, industry, founded_year (the year), headquarters, description (one or two sentences, in the document's words), website, size (staff count or range).
- section "people", subject = the person's name, field one of: name, role, email, phone, department. Only people who work for or with the organisation in a stated role — founders, staff, board, advisors. Never the authors of cited works.
- section "services" (products and services it offers) or "projects" (its projects), subject = the product or project name, field one of: name, description, status.
- section "legal", subject = the agreement's name, field one of: name, type, summary, effective_date, expiry_date, parties, status — only agreements the organisation is party to.
- section "markets", subject null, field one of: primary, verticals, geographies (where it operates or serves) — one statement per market.
- section "policies", subject null, field = the certification or compliance key (e.g. "SOC2", "GDPR", "HIPAA"). A software license is not a policy: it is profile "business_model".
- section "profile", subject null, field one of: mission, programs, beneficiaries, outcomes, need, legal_status, annual_budget, funding_sources, funding_raised, customers, traction, business_model, pricing, leadership, board, partners, awards, theory_of_change, evaluation, plans — reusable facts a proposal or pitch writer keeps at hand. Value specific (figures with their year, names with their roles), under 60 words, plain prose.

For a person, product, project or agreement, the quote must name the subject.

Be thorough: return every fact the passages state, not a sample. Each product, feature area or service the organisation offers is its own "services" statement (name, then description); who it is for is profile "beneficiaries" or "customers"; how it is priced or licensed is profile "pricing" or "business_model"; where it operates is a "markets" geography. A page of the organisation's own material usually states ten or more facts.

Never invent a number, date or name. If the passages hold no facts about the organisation, return an empty list.`;

export function buildExtractionPrompt(input: {
    companyName: string;
    documentName: string;
    passages: string;
    batchIndex: number;
    totalBatches: number;
    /** A person in the organisation said this document speaks for it. */
    vouched?: boolean;
}): string {
    const vouched = input.vouched
        ? `\nA person at ${input.companyName} marked this document as written by or about ${input.companyName}: read its authors, "we" and "our" as ${input.companyName}, and its work, results and affiliations as ${input.companyName}'s.\n`
        : "";
    return `ORGANISATION: ${input.companyName}
DOCUMENT: "${input.documentName}" — part ${input.batchIndex + 1} of ${input.totalBatches}
${vouched}
PASSAGES:
---
${input.passages}
---

Extract the facts these passages state about ${input.companyName}, each with its exact quote and passage number.`;
}

// ============================================================================
// Writing the summary
// ============================================================================

export const SUMMARY_SYSTEM_PROMPT = `You write the top of an organisation's profile from facts that were each read, with a quote, from the organisation's own documents.

You are given the organisation's name and NUMBERED FACTS [F#]. Produce:
- summary: two to four sentences on who the organisation is, what it does and for whom — only what the facts say; cite the facts used in summary_facts.
- applicant_type: nonprofit, small_business, for_profit, individual, or unknown when the facts do not say; cite the deciding facts.
- focus_areas: up to six short phrases a funder or investor would file the organisation under (e.g. "youth literacy", "developer tools"), each citing the facts it rests on.

Use no knowledge beyond the facts. If the facts are too thin for a summary, return an empty summary.`;
