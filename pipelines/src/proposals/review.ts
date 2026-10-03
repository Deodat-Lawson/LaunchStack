/**
 * Readiness and the deterministic half of a review. The model finds weak
 * spots (./stages); this module finds what can be checked without one:
 * sections with nothing in them, drafts over their limit, eligibility rules
 * nobody ticked, a deadline that has passed. Readiness is computed here so
 * it means the same thing on the list, the detail page and the home screen.
 */
import type {
    ApplicationRecord,
    Requirement,
    ReviewFinding,
    SectionRecord,
    SectionStatus,
} from "./types";
import { daysUntil, wordCount } from "./text";

const SECTION_WEIGHT = 0.7;
const CHECKLIST_WEIGHT = 0.3;

const SECTION_CREDIT: Record<SectionStatus, number> = {
    empty: 0,
    drafted: 0.6,
    edited: 0.85,
    approved: 1,
};

/** Over the limit by more than this share counts as over. */
export const LIMIT_TOLERANCE = 0.1;

export function overLimit(section: Pick<SectionRecord, "draft" | "wordLimit">): boolean {
    if (!section.wordLimit || !section.draft) return false;
    return wordCount(section.draft) > section.wordLimit * (1 + LIMIT_TOLERANCE);
}

/**
 * 0–100. Required sections carry most of the weight (approved counts in
 * full, a raw draft a little over half); the rest of the checklist carries
 * the remainder. An application with no sections yet is as ready as its
 * checklist alone.
 */
export function computeReadiness(input: {
    sections: Pick<SectionRecord, "status" | "required" | "draft" | "wordLimit">[];
    requirements: Requirement[];
}): number {
    const required = input.sections.filter(s => s.required);
    const sectionsScore =
        required.length === 0
            ? null
            : required.reduce((sum, s) => {
                  const credit = SECTION_CREDIT[s.status];
                  return sum + (overLimit(s) ? Math.min(credit, 0.6) : credit);
              }, 0) / required.length;
    const checklist = input.requirements.filter(r => r.kind !== "section");
    const checklistScore =
        checklist.length === 0 ? null : checklist.filter(r => r.done).length / checklist.length;

    if (sectionsScore === null && checklistScore === null) return 0;
    if (sectionsScore === null) return Math.round(checklistScore! * 100);
    if (checklistScore === null) return Math.round(sectionsScore * 100);
    return Math.round((sectionsScore * SECTION_WEIGHT + checklistScore * CHECKLIST_WEIGHT) * 100);
}

/** Section checklist rows mirror section status; a person ticks the rest. */
export function syncSectionRequirements(
    requirements: Requirement[],
    sections: Pick<SectionRecord, "key" | "status">[]
): Requirement[] {
    const byKey = new Map(sections.map(s => [s.key, s.status]));
    return requirements.map(r =>
        r.kind === "section" && r.sectionKey
            ? { ...r, done: byKey.get(r.sectionKey) === "approved" }
            : r
    );
}

/** What can be said about an application without reading it. */
export function deterministicFindings(input: {
    application: Pick<ApplicationRecord, "deadline" | "requirements">;
    sections: SectionRecord[];
    now: Date;
}): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const section of input.sections) {
        if (section.required && section.status === "empty") {
            findings.push({
                id: `missing:${section.key}`,
                severity: "blocker",
                kind: "missing",
                sectionKey: section.key,
                message: `"${section.question}" has no answer yet.`,
                suggestion: "Draft it from your sources, or write it by hand.",
            });
        }
        if (overLimit(section)) {
            findings.push({
                id: `over_limit:${section.key}`,
                severity: "warning",
                kind: "over_limit",
                sectionKey: section.key,
                message: `${wordCount(section.draft)} words against a limit of ${section.wordLimit}.`,
                suggestion:
                    "Cut to the limit; funders often truncate or reject over-length answers.",
            });
        }
        if (
            section.status !== "empty" &&
            section.draft &&
            (section.draftMeta?.cites.length ?? 0) === 0 &&
            section.status !== "approved"
        ) {
            findings.push({
                id: `unsupported:${section.key}`,
                severity: "note",
                kind: "unsupported",
                sectionKey: section.key,
                message: "This answer cites none of your sources.",
                suggestion:
                    "Add the document that backs its claims, or approve it as written knowledge.",
            });
        }
    }
    for (const rule of input.application.requirements) {
        if (rule.kind === "eligibility" && !rule.done) {
            findings.push({
                id: `eligibility:${rule.id}`,
                severity: "warning",
                kind: "eligibility",
                sectionKey: null,
                message: `Eligibility not confirmed: ${rule.text}`,
                suggestion:
                    "Tick it once you have checked it, or drop the application if it does not apply.",
            });
        }
        if (rule.kind === "attachment" && !rule.done) {
            findings.push({
                id: `attachment:${rule.id}`,
                severity: "note",
                kind: "attachment",
                sectionKey: null,
                message: `Attachment still to gather: ${rule.text}`,
                suggestion: null,
            });
        }
    }
    const days = daysUntil(input.application.deadline, input.now);
    if (days !== null && days < 0) {
        findings.push({
            id: "deadline:passed",
            severity: "blocker",
            kind: "deadline",
            sectionKey: null,
            message: `The deadline passed ${-days} day${days === -1 ? "" : "s"} ago.`,
            suggestion: "Ask the funder about the next cycle, or withdraw the application.",
        });
    } else if (days !== null && days <= 3) {
        findings.push({
            id: "deadline:soon",
            severity: "warning",
            kind: "deadline",
            sectionKey: null,
            message:
                days === 0
                    ? "The deadline is today."
                    : `${days} day${days === 1 ? "" : "s"} to the deadline.`,
            suggestion: null,
        });
    }
    return findings;
}

/** Deterministic rows first, then the model's, without saying the same thing twice. */
export function mergeFindings(base: ReviewFinding[], extra: ReviewFinding[]): ReviewFinding[] {
    const seen = new Set(base.map(f => `${f.kind}|${f.sectionKey ?? ""}`));
    const out = [...base];
    for (const finding of extra) {
        const key = `${finding.kind}|${finding.sectionKey ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(finding);
    }
    const rank = { blocker: 0, warning: 1, note: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
