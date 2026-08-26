import {
    FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    type FounderWeeklyReviewEvidenceItem,
    type FounderWeeklyReviewPayload,
    type FounderWeeklyReviewV2Payload,
} from "@launchstack/pipelines/founder-weekly-review";

type RenderableRun = {
    reportingPeriod: { start: string; end: string };
    modelMetadata: { model?: string } | null;
    /**
     * A persisted payload may still be a legacy v1 document, whose sections
     * carry `heading`/`items` instead of the v2 `state` discriminant. This
     * renderer speaks v2 only; the parameter is the union so that fact is
     * checked rather than assumed.
     */
    reviewPayload: FounderWeeklyReviewPayload | null;
    evidenceSnapshot: { items: FounderWeeklyReviewEvidenceItem[] } | null;
};

type V2Sections = FounderWeeklyReviewV2Payload["sections"];
type SectionKey = keyof V2Sections;
/** Every section is either a list of items or a no-evidence placeholder. */
type SectionItem = Extract<V2Sections[SectionKey], { state: "evidence" }>["items"][number];

const SECTION_ORDER = [
    "whatShipped",
    "whatChanged",
    "whatCustomersSaid",
    "currentBlockers",
    "nextPriorities",
] as const;
const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
    whatShipped: "Shipped This Period",
    whatChanged: "Other Meaningful Changes",
    whatCustomersSaid: "Customer Signals",
    currentBlockers: "Risks & Blockers",
    nextPriorities: "Priorities for the Next Period",
};
const REFERENCE_SEPARATOR = String.fromCharCode(0x2014);

function metadataNumber(item: FounderWeeklyReviewEvidenceItem, key: string): string | null {
    const value = item.metadata[key];
    return typeof value === "number" || typeof value === "string" ? String(value) : null;
}

export function formatFounderWeeklyReviewEvidenceReference(
    item: FounderWeeklyReviewEvidenceItem
): string {
    if (item.sourceType === "founder_context") return "Founder-provided context";
    const details: string[] = [];
    const page = metadataNumber(item, "pageNumber");
    const section = metadataNumber(item, "sectionId");
    if (page) details.push(`page ${page}`);
    if (section) details.push(`section ${section}`);
    const title = item.title.trim() || "Untitled evidence";
    const prefix =
        item.sourceType === "document_change" ? `Document change ${REFERENCE_SEPARATOR} ` : "";
    return [prefix + title, ...details].join(` ${REFERENCE_SEPARATOR} `);
}

/** Renders only a persisted, validated draft and intentionally excludes operational internals. */
export function renderFounderWeeklyReviewMarkdown(run: RenderableRun): string {
    if (!run.reviewPayload || !run.evidenceSnapshot) {
        throw new Error(
            "A persisted review payload and evidence snapshot are required for Markdown rendering."
        );
    }
    const sources = new Map(run.evidenceSnapshot.items.map(item => [item.sourceId, item]));
    const referenceNumbers = new Map<string, number>();
    const references: string[] = [];
    const cite = (sourceIds: readonly string[]) =>
        sourceIds
            .map(sourceId => {
                let number = referenceNumbers.get(sourceId);
                if (!number) {
                    number = referenceNumbers.size + 1;
                    referenceNumbers.set(sourceId, number);
                    const source = sources.get(sourceId);
                    if (source)
                        references.push(
                            `[${number}] ${formatFounderWeeklyReviewEvidenceReference(source)}`
                        );
                }
                return `[${number}]`;
            })
            .join("");
    if (run.reviewPayload.schemaVersion !== FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION) {
        // Previously this field was `any`, so a legacy row reached the section
        // loop and failed on an undefined `state` deep inside rendering.
        throw new Error(
            `Markdown rendering supports ${FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION} payloads; ` +
                `this run holds ${run.reviewPayload.schemaVersion}. Regenerate the review.`
        );
    }
    const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
    const payload: FounderWeeklyReviewV2Payload = run.reviewPayload;
    const shipped = new Set(
        payload.sections.whatShipped.state === "evidence"
            ? payload.sections.whatShipped.items.map(item => normalize(item.text))
            : []
    );
    const lines = [
        "# Founder Weekly Review",
        "",
        `**Reporting period:** ${run.reportingPeriod.start} to ${run.reportingPeriod.end}`,
        "",
    ];
    for (const key of SECTION_ORDER) {
        const section: V2Sections[SectionKey] = payload.sections[key];
        const items: SectionItem[] =
            section.state === "evidence"
                ? section.items.filter(
                      item => key !== "whatChanged" || !shipped.has(normalize(item.text))
                  )
                : [];
        const noEvidence = section.state === "no_evidence" ? section.noEvidence : null;
        if (!items.length && !noEvidence) continue;
        lines.push(`## ${SECTION_LABELS[key]}`, "");
        if (noEvidence) {
            lines.push(noEvidence.message, "", `Next: ${noEvidence.cta}`, "");
            continue;
        }
        items.forEach((item, index) => {
            const marker = key === "nextPriorities" ? `${index + 1}.` : "-";
            lines.push(`${marker} ${item.text}${cite(item.sourceIds)}`);
            if (item.kind === "recommendation" && item.rationale) {
                lines.push(`  - Why now: ${item.rationale}${cite(item.sourceIds)}`);
            }
        });
        lines.push("");
    }
    if (references.length) lines.push("## Evidence References", "", ...references, "");
    lines.push("---", "", `*Generated with ${run.modelMetadata?.model ?? "the configured model"}*`);
    return lines.join("\n");
}
