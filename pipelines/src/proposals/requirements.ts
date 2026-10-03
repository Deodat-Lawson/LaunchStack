/**
 * From a funder's request to a checklist. The model reads the request
 * (./stages); this module is the deterministic half — cleaning what the
 * model returned and turning it into requirement rows with stable ids, so
 * a re-extraction keeps a person's ticks wherever the text still matches.
 */
import type { ExtractedRequest, ExtractedSection, Requirement } from "./types";
import { blankToNull, slugKey } from "./text";

const MAX_SECTIONS = 40;
const MAX_LIST = 30;

function cleanList(items: string[] | undefined, max = MAX_LIST): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of items ?? []) {
        const text = raw.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text.slice(0, 500));
        if (out.length >= max) break;
    }
    return out;
}

function cleanDay(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function cleanMoney(raw: number | null | undefined): number | null {
    if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
}

/** Deterministic clean-up of what the model read: unique slug keys, sane limits, capped lists. */
export function sanitizeExtracted(raw: ExtractedRequest): ExtractedRequest {
    const keys = new Set<string>();
    const sections: ExtractedSection[] = [];
    for (const section of raw.sections ?? []) {
        const question = section.question?.replace(/\s+/g, " ").trim();
        if (!question) continue;
        let key = slugKey(section.key || question);
        let suffix = 2;
        while (keys.has(key)) key = `${slugKey(section.key || question, 44)}-${suffix++}`;
        keys.add(key);
        const wordLimit =
            section.wordLimit && Number.isFinite(section.wordLimit) && section.wordLimit > 0
                ? Math.round(section.wordLimit)
                : null;
        sections.push({
            key,
            question: question.slice(0, 1_000),
            guidance: blankToNull(section.guidance?.replace(/\s+/g, " "))?.slice(0, 2_000) ?? null,
            wordLimit,
            required: section.required !== false,
        });
        if (sections.length >= MAX_SECTIONS) break;
    }
    const amountMin = cleanMoney(raw.amountMin);
    const amountMax = cleanMoney(raw.amountMax);
    return {
        title: blankToNull(raw.title)?.slice(0, 512) ?? null,
        funder: blankToNull(raw.funder)?.slice(0, 256) ?? null,
        summary: blankToNull(raw.summary?.replace(/\s+/g, " "))?.slice(0, 2_000) ?? null,
        deadline: cleanDay(raw.deadline),
        amountMin:
            amountMin !== null && amountMax !== null && amountMin > amountMax
                ? amountMax
                : amountMin,
        amountMax,
        eligibility: cleanList(raw.eligibility),
        sections,
        attachments: cleanList(raw.attachments),
        format: cleanList(raw.format),
    };
}

/**
 * The checklist: one row per eligibility rule, per section, per attachment,
 * per format rule, plus the deadline. Ids are derived from the content so a
 * re-extraction keeps `done` on rows that still exist.
 */
export function requirementsFromExtracted(
    extracted: ExtractedRequest,
    previous: Requirement[] = []
): Requirement[] {
    const done = new Map(previous.map(r => [r.id, r.done]));
    const rows: Requirement[] = [];
    const push = (id: string, kind: Requirement["kind"], text: string, sectionKey: string | null) =>
        rows.push({ id, kind, text, done: done.get(id) ?? false, sectionKey });

    for (const rule of extracted.eligibility)
        push(`eligibility:${slugKey(rule, 40)}`, "eligibility", rule, null);
    if (extracted.deadline) push("deadline", "deadline", `Submit by ${extracted.deadline}`, null);
    if (extracted.amountMax || extracted.amountMin) {
        const range =
            extracted.amountMin && extracted.amountMax
                ? `Request between $${extracted.amountMin.toLocaleString()} and $${extracted.amountMax.toLocaleString()}`
                : extracted.amountMax
                  ? `Request at most $${extracted.amountMax.toLocaleString()}`
                  : `Request at least $${extracted.amountMin!.toLocaleString()}`;
        push("budget", "budget", range, null);
    }
    for (const section of extracted.sections)
        push(
            `section:${section.key}`,
            "section",
            `${section.required ? "Answer" : "Optional"}: ${section.question}${section.wordLimit ? ` (${section.wordLimit} words)` : ""}`,
            section.key
        );
    for (const attachment of extracted.attachments)
        push(`attachment:${slugKey(attachment, 40)}`, "attachment", attachment, null);
    for (const rule of extracted.format) push(`format:${slugKey(rule, 40)}`, "format", rule, null);
    return rows;
}

/** Flip one checklist row; section rows are computed from the section's status, never ticked by hand. */
export function toggleRequirement(
    requirements: Requirement[],
    id: string,
    done: boolean
): Requirement[] {
    return requirements.map(r => (r.id === id && r.kind !== "section" ? { ...r, done } : r));
}
