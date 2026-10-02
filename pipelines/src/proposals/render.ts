/**
 * Application → markdown for the Sources library, plus the convergent
 * creation key (the mindmap `mindmap:<id>:<revision>` rule with different
 * nouns): the same application exported again replaces the same source.
 */
import type { ApplicationRecord, Evidence, SectionRecord } from "./types";
import { wordCount } from "./text";

export function makeApplicationCreationKey(applicationId: string, exportedAt: Date): string {
    return `grant-application:${applicationId}:${exportedAt.toISOString().slice(0, 10)}`;
}

export function makeApplicationFilename(application: Pick<ApplicationRecord, "title">): string {
    const base =
        application.title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 80) || "grant-application";
    return `${base}.md`;
}

export function renderApplicationMarkdown(input: {
    application: ApplicationRecord;
    sections: SectionRecord[];
    exportedAt: Date;
}): string {
    const { application, sections } = input;
    const lines: string[] = [];
    lines.push(`# ${application.title}`, "");
    lines.push(
        [
            application.funder ? `**Funder:** ${application.funder}` : null,
            application.deadline ? `**Deadline:** ${application.deadline}` : null,
            `**Status:** ${application.status.replace(/_/g, " ")}`,
            `**Readiness:** ${application.readiness}/100`,
        ]
            .filter(Boolean)
            .join(" · "),
        ""
    );
    if (application.extracted?.summary) lines.push(`> ${application.extracted.summary}`, "");

    const evidence: Evidence[] = [];
    const renumber = new Map<string, number>();
    const cite = (e: Evidence): number => {
        const key = `${e.documentId ?? "?"}|${e.page ?? "?"}|${e.quote.slice(0, 60)}`;
        const existing = renumber.get(key);
        if (existing) return existing;
        const n = evidence.length + 1;
        evidence.push({ ...e, n });
        renumber.set(key, n);
        return n;
    };

    for (const section of sections) {
        lines.push(`## ${section.question}`);
        if (section.wordLimit)
            lines.push(
                `*Limit ${section.wordLimit} words · draft ${wordCount(section.draft)} words*`
            );
        lines.push("");
        if (!section.draft?.trim()) {
            lines.push("_Not written yet._", "");
            continue;
        }
        lines.push(section.draft.trim());
        const cited = (section.draftMeta?.cites ?? [])
            .map(n => section.draftMeta?.evidence.find(e => e.n === n))
            .filter((e): e is Evidence => Boolean(e))
            .map(cite);
        if (cited.length > 0) lines.push("", `Sources: ${cited.map(n => `[E${n}]`).join(" ")}`);
        if (section.draftMeta?.gaps.length)
            lines.push("", `Still needed: ${section.draftMeta.gaps.join("; ")}`);
        lines.push("");
    }

    const checklist = application.requirements.filter(r => r.kind !== "section");
    if (checklist.length > 0) {
        lines.push("## Checklist", "");
        for (const r of checklist) lines.push(`- [${r.done ? "x" : " "}] ${r.text}`);
        lines.push("");
    }

    if (evidence.length > 0) {
        lines.push("## Evidence", "");
        for (const e of evidence)
            lines.push(`- [E${e.n}] ${e.title}${e.page ? `, p. ${e.page}` : ""}: “${e.quote}”`);
        lines.push("");
    }

    lines.push(
        "---",
        `Exported from LaunchStack Grants on ${input.exportedAt.toISOString().slice(0, 10)}.`
    );
    return lines.join("\n");
}
