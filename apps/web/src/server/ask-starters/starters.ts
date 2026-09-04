/**
 * The pure half of starter generation: the prompt the model sees, the shaping
 * of what it returns, and the deterministic set used when there is no model
 * (or no evidence worth spending a call on).
 *
 * Nothing here touches the database or a model, so every rule about what a
 * starter may say is unit-testable without either.
 */

import {
    ASK_STARTER_COUNT,
    ASK_STARTER_HINT_MAX_CHARS,
    ASK_STARTER_MAX_DOCUMENTS,
    ASK_STARTER_QUESTION_MAX_CHARS,
    type AskStarter,
    type GeneratedStarters,
} from "~/lib/ask-starters/contract";

export interface BriefDocument {
    id: number;
    title: string;
    folder: string;
    /** "2 days ago", "just now" — for the prompt and for hints. */
    ageLabel: string;
}

export interface BriefFolder {
    name: string;
    count: number;
}

/** Everything the generator knows about a workspace, assembled by `brief.ts`. */
export interface WorkspaceBrief {
    company: {
        name: string | null;
        description: string | null;
        industry: string | null;
        size: string | null;
    };
    /** Confidence-gated profile text from extracted company metadata, or null when none exists. */
    profileText: string | null;
    sourceCount: number;
    /** Largest folders first. */
    folders: BriefFolder[];
    /** Newest first. Only these ids may be pinned by a generated starter. */
    recentDocuments: BriefDocument[];
    /** Active connector providers, e.g. "google-drive". */
    connections: string[];
    /** Changes whenever the evidence changes; the cache key. */
    fingerprint: string;
}

export const STARTERS_SYSTEM_PROMPT = [
    "You write the four starter questions on the home screen of a company's knowledge workspace.",
    "The workspace answers a question by searching the sources listed in the evidence and citing them.",
    "",
    "Write questions the people who run this company would want answered this week. Ground every",
    "question in the evidence you are given: the company profile, the folders, the recent documents,",
    "and the connected systems. Never mention a document, person, product, customer, or system that",
    "is not in the evidence.",
    "",
    "Rules:",
    `- Exactly ${ASK_STARTER_COUNT} questions. Each 8–14 words and under ${ASK_STARTER_QUESTION_MAX_CHARS} characters,`,
    '  phrased as a direct question or a "Summarize…" / "Compare…" instruction. No numbering.',
    "- Vary the shape: one broad question across all sources; one about a specific recent document",
    "  (set its id in documentIds); one about the company's operations — customers, services,",
    "  projects, contracts, policies, or deadlines — as evidenced by the profile or the titles; one",
    "  that looks for change, risk, or gaps (renewals, missing exhibits, conflicting versions, open",
    "  decisions).",
    "- documentIds may only contain ids from the recent documents list. Leave it empty for questions",
    "  that span sources.",
    '- hint: 3–7 words saying where the answer will come from, e.g. "from the MSA and pricing deck",',
    '  "across 42 sources", "from your company profile".',
    "- Use the company's own vocabulary from the evidence. Plain language, no marketing tone, no emoji.",
    "- Refer to documents by title, without the file extension.",
    '- Never credit a source the evidence says is absent — no "from your company profile" when none',
    "  has been extracted, no connected system that is not listed.",
].join("\n");

const PROFILE_MAX_CHARS = 3000;
const DESCRIPTION_MAX_CHARS = 600;

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The evidence block the model reads. */
export function buildStarterPrompt(brief: WorkspaceBrief, options?: { avoid?: string[] }): string {
    const lines: string[] = [];
    const company = brief.company;

    lines.push("=== Company ===");
    lines.push(`Name: ${company.name ?? "Unknown"}`);
    if (company.industry) lines.push(`Industry: ${company.industry}`);
    if (company.size) lines.push(`Size: ${company.size}`);
    if (company.description) {
        lines.push(`Description: ${clip(company.description, DESCRIPTION_MAX_CHARS)}`);
    }

    lines.push("", "=== Company profile (extracted from its documents) ===");
    lines.push(
        brief.profileText
            ? clip(brief.profileText, PROFILE_MAX_CHARS)
            : "No profile has been extracted yet."
    );

    lines.push("", "=== Knowledge base ===");
    lines.push(`${brief.sourceCount} source${brief.sourceCount === 1 ? "" : "s"} indexed.`);
    if (brief.folders.length > 0) {
        lines.push(`Folders: ${brief.folders.map(f => `${f.name} (${f.count})`).join(", ")}`);
    }
    if (brief.connections.length > 0) {
        lines.push(`Connected systems: ${brief.connections.join(", ")}`);
    }

    lines.push("", "=== Recent documents (id · title · folder · added) ===");
    if (brief.recentDocuments.length === 0) {
        lines.push("None yet.");
    } else {
        for (const doc of brief.recentDocuments) {
            lines.push(`${doc.id} · ${doc.title} · ${doc.folder} · ${doc.ageLabel}`);
        }
    }

    if (options?.avoid && options.avoid.length > 0) {
        lines.push("", "=== Already shown — write different questions ===");
        for (const q of options.avoid) lines.push(`- ${q}`);
    }

    return lines.join("\n");
}

function normalizeQuestion(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanQuestion(raw: string): string {
    const stripped = raw
        .replace(/\s+/g, " ")
        .trim()
        // Models number or bullet their lists despite instructions.
        .replace(/^(?:\d+[.)]|[-*•])\s+/, "")
        .trim();
    // A question wrapped in quotes loses them; one that *contains* a quoted
    // title keeps its closing quote.
    const unwrapped = /^["“].*["”]$/.test(stripped) ? stripped.slice(1, -1).trim() : stripped;
    return clip(unwrapped, ASK_STARTER_QUESTION_MAX_CHARS);
}

function cleanHint(raw: string): string {
    return clip(raw.replace(/\s+/g, " ").trim().replace(/[.]+$/, ""), ASK_STARTER_HINT_MAX_CHARS);
}

/**
 * Shape a model response into starters the client can trust: unknown document
 * ids dropped, duplicates removed, lengths capped, and at most four kept. May
 * return fewer than four — `completeStarters` pads.
 */
export function sanitizeStarters(raw: GeneratedStarters, brief: WorkspaceBrief): AskStarter[] {
    const knownIds = new Set(brief.recentDocuments.map(d => d.id));
    const seen = new Set<string>();
    const out: AskStarter[] = [];

    for (const candidate of raw.starters) {
        const question = readTitlesPlainly(cleanQuestion(candidate.question), brief);
        // Anything shorter than this is a fragment, not a question.
        if (question.length < 12) continue;
        const key = normalizeQuestion(question);
        if (!key || seen.has(key)) continue;

        const documentIds = [...new Set(candidate.documentIds)]
            .filter(id => knownIds.has(id))
            .slice(0, ASK_STARTER_MAX_DOCUMENTS);

        seen.add(key);
        out.push({
            id: `g${out.length + 1}`,
            question,
            hint: cleanHint(candidate.hint) || defaultHint(documentIds, brief),
            documentIds,
        });
        if (out.length === ASK_STARTER_COUNT) break;
    }

    return out;
}

/** Models quote titles verbatim, extension and all; a sentence reads better without it. */
function readTitlesPlainly(question: string, brief: WorkspaceBrief): string {
    let out = question;
    for (const doc of brief.recentDocuments) {
        if (!doc.title || !out.includes(doc.title)) continue;
        out = out.split(doc.title).join(displayTitle(doc.title, 64));
    }
    return out;
}

function defaultHint(documentIds: number[], brief: WorkspaceBrief): string {
    if (documentIds.length > 0) {
        const doc = brief.recentDocuments.find(d => d.id === documentIds[0]);
        if (doc) return `from ${displayTitle(doc.title, 40)}`;
    }
    return brief.sourceCount > 0
        ? `across ${brief.sourceCount} source${brief.sourceCount === 1 ? "" : "s"}`
        : "across your sources";
}

const FILE_EXTENSION = /\.(pdf|docx?|pptx?|xlsx?|csv|md|markdown|txt|rtf|html?|json|ya?ml)$/i;

/** A document title as it reads inside a sentence: no extension, clipped at a word. */
export function displayTitle(title: string, max = 48): string {
    const base = title.replace(FILE_EXTENSION, "").replace(/\s+/g, " ").trim();
    if (base.length <= max) return base;
    const cut = base.slice(0, max);
    const atWord = cut.lastIndexOf(" ");
    return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/**
 * The set shown when there is no model, the model failed, or there is nothing
 * for a model to work from. Still grounded in the workspace — names, titles,
 * folders — so the cards never read as generic filler when the data exists.
 */
export function fallbackStarters(brief: WorkspaceBrief): AskStarter[] {
    const name = brief.company.name ?? "this company";
    const [newest, second] = brief.recentDocuments;
    const topFolder = brief.folders[0];
    const sourceCount = brief.sourceCount;
    const across =
        sourceCount > 0
            ? `across ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
            : "add a source to ground the answer";

    const candidates: Omit<AskStarter, "id">[] = [];

    if (newest) {
        candidates.push({
            question: `Summarize "${displayTitle(newest.title)}"`,
            hint: `added ${newest.ageLabel}`,
            documentIds: [newest.id],
        });
    }
    if (topFolder && topFolder.count > 1) {
        candidates.push({
            question: `What are the key dates and deadlines in ${topFolder.name}?`,
            hint: `${topFolder.count} sources in ${topFolder.name}`,
            documentIds: [],
        });
    }
    candidates.push({
        question: `What does ${name} do, according to these sources?`,
        hint: across,
        documentIds: [],
    });
    if (second) {
        candidates.push({
            question: `What are the main points of "${displayTitle(second.title)}"?`,
            hint: `${second.folder} · ${second.ageLabel}`,
            documentIds: [second.id],
        });
    }
    candidates.push(
        {
            question: "Which decisions, risks, or open questions come up most often?",
            hint: "themes across every source",
            documentIds: [],
        },
        {
            question: "Who are the people and organizations mentioned most?",
            hint: "names across every source",
            documentIds: [],
        },
        {
            question: "What changed in the documents added this week?",
            hint: "recent additions",
            documentIds: [],
        }
    );

    return candidates.slice(0, ASK_STARTER_COUNT).map((c, i) => ({ ...c, id: `f${i + 1}` }));
}

/** Pad a short generated set up to four with fallbacks that do not repeat it. */
export function completeStarters(starters: AskStarter[], brief: WorkspaceBrief): AskStarter[] {
    if (starters.length >= ASK_STARTER_COUNT) return starters.slice(0, ASK_STARTER_COUNT);
    const seen = new Set(starters.map(s => normalizeQuestion(s.question)));
    const out = [...starters];
    for (const fallback of fallbackStarters(brief)) {
        if (out.length === ASK_STARTER_COUNT) break;
        const key = normalizeQuestion(fallback.question);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...fallback, id: `g${out.length + 1}` });
    }
    return out;
}

/** True when the workspace holds anything a model could ground a question in. */
export function hasEvidence(brief: WorkspaceBrief): boolean {
    return (
        brief.sourceCount > 0 ||
        Boolean(brief.profileText) ||
        Boolean(brief.company.description?.trim())
    );
}

/** "just now", "3h ago", "Yesterday", "5 days ago", "3 weeks ago", or a date. */
export function relativeAge(date: Date, now: Date = new Date()): string {
    const diffMs = now.getTime() - date.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return "last week";
    if (weeks < 5) return `${weeks} weeks ago`;
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
