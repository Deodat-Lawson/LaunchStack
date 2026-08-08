import { FounderWeeklyReviewEvidenceSnapshotSchema, FounderWeeklyReviewV2PayloadSchema, type FounderWeeklyReviewEvidenceSnapshot, type FounderWeeklyReviewV2Payload } from "./contracts";

export type EvaluationFailure = { category: string; section?: string; claim?: string; explanation: string };
export type DeterministicEvaluation = {
    canonicalSchemaValid: boolean;
    citationValidity: number;
    citationCoverage: number;
    sourceSemanticViolationRate: number;
    unsupportedClaimRate: number;
    unsupportedShippedClaimRate: number;
    duplicateClaimRate: number;
    evidenceCoverage: number;
    emptySectionCorrectness: number;
};
export type EvaluationResult = {
    passed: boolean;
    hasHardFailure: boolean;
    deterministic: DeterministicEvaluation;
    failures: EvaluationFailure[];
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9%$]+/g, " ").replace(/\s+/g, " ").trim();
const words = (value: string) => new Set(normalize(value).split(" ").filter(word => word.length > 3));
const overlap = (claim: string, evidence: string) => {
    const claimWords = words(claim); const evidenceWords = words(evidence);
    return [...claimWords].filter(word => evidenceWords.has(word)).length >= 2;
};
const items = (section: unknown): Array<Record<string, unknown>> => {
    if (!section || typeof section !== "object" || !("items" in section) || !Array.isArray(section.items)) return [];
    return section.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
};
const isTemporal = (sourceTypes: string[]) => sourceTypes.includes("document_change");

const monthNumbers: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function futureReleaseMentioned(text: string, periodEnd: string): boolean {
    const lower = text.toLowerCase();
    if (!/(planned|scheduled|expected|launch|ship|release|deploy)/i.test(lower)) return false;
    const end = new Date(`${periodEnd}T23:59:59.999Z`);
    const year = end.getUTCFullYear();
    for (const [month, number] of Object.entries(monthNumbers)) {
        if (!new RegExp(`\\b${month}\\b`, "i").test(lower)) continue;
        const candidate = new Date(Date.UTC(year, number - 1, 1));
        if (candidate > end) return true;
    }
    const yearMention = lower.match(/\b(20\d{2})\b/);
    return yearMention ? Number(yearMention[1]) > year : false;
}

export function evaluateFounderWeeklyReview(evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot, report: FounderWeeklyReviewV2Payload): EvaluationResult {
    const failures: EvaluationFailure[] = [];
    const evidence = new Map(evidenceSnapshot.items.map(item => [item.sourceId, item]));
    let canonicalSchemaValid = true;
    try { FounderWeeklyReviewEvidenceSnapshotSchema.parse(evidenceSnapshot); FounderWeeklyReviewV2PayloadSchema.parse(report); } catch { canonicalSchemaValid = false; failures.push({ category: "malformed_payload", explanation: "Snapshot or review does not satisfy its canonical schema." }); }
    if (!canonicalSchemaValid) return { passed: false, hasHardFailure: true, deterministic: { canonicalSchemaValid, citationValidity: 0, citationCoverage: 0, sourceSemanticViolationRate: 1, unsupportedClaimRate: 0, unsupportedShippedClaimRate: 0, duplicateClaimRate: 0, evidenceCoverage: 0, emptySectionCorrectness: 0 }, failures };
    let citations = 0, validCitations = 0, claimCount = 0, citedClaims = 0, semanticChecks = 0, semanticViolations = 0, unsupported = 0, supportChecks = 0, shippedChecks = 0, unsupportedShipped = 0;
    const claims = new Set<string>(); let duplicateClaims = 0;
    const covered = new Set<string>();
    for (const [sectionName, section] of Object.entries(report.sections)) {
        const sectionItems = items(section);
        for (const item of sectionItems) {
            const claim = typeof item.text === "string" ? item.text : "";
            const normalizedClaim = normalize(claim);
            if (normalizedClaim) { claimCount++; const sectionClaim = `${sectionName}:${normalizedClaim}`; if (claims.has(sectionClaim)) { duplicateClaims++; failures.push({ category: "duplicate_claim", section: sectionName, claim, explanation: "Repeated claim within the same section." }); } claims.add(sectionClaim); }
            const ids = Array.isArray(item.sourceIds) ? item.sourceIds.filter((id): id is string => typeof id === "string") : [];
            if (["observed_fact", "contradictory_evidence", "recommendation"].includes(String(item.kind))) { if (ids.length) citedClaims++; }
            if (claim && ids.length) {
                const cited = ids.map(id => evidence.get(id)).filter(Boolean);
                const combined = cited.map(source => `${source!.title} ${source!.excerpt}`).join(" ");
                supportChecks++; if (overlap(claim, combined)) cited.forEach(source => covered.add(source!.sourceId)); else if (item.kind !== "recommendation" && item.kind !== "contradictory_evidence") { unsupported++; failures.push({ category: "unsupported_claim", section: sectionName, claim, explanation: "Soft lexical diagnostic: claim has limited overlap with cited evidence." }); }
            }
            for (const id of ids) {
                citations++; const source = evidence.get(id);
                if (!source) { failures.push({ category: "invalid_citation", section: sectionName, claim, explanation: `Unknown sourceId: ${id}` }); continue; }
                validCitations++;
                const sourceType = source.sourceType;
                semanticChecks++;
                const allowed = sectionName === "whatCustomersSaid" ? sourceType === "customer_feedback" : sectionName === "whatChanged" || sectionName === "whatShipped" ? (sourceType === "document_change" || (sourceType === "workspace_document" && ids.some(other => evidence.get(other)?.sourceType === "document_change"))) : true;
                if (!allowed) { semanticViolations++; failures.push({ category: "invalid_source_type", section: sectionName, claim, explanation: `${sourceType} cannot independently support ${sectionName}.` }); }
                if (sectionName === "whatShipped") {
                    shippedChecks++;
                    const sourceText = `${source.title} ${source.excerpt}`;
                    if (!/launch|ship|release|deploy|complete|implement/i.test(sourceText)) { unsupportedShipped++; failures.push({ category: "unsupported_shipped_claim", section: sectionName, claim, explanation: "Cited source has no explicit shipping signal." }); }
                    if (sourceType === "document_change" && futureReleaseMentioned(`${claim} ${sourceText}`, evidenceSnapshot.reportingPeriod.end)) {
                        failures.push({ category: "future_release_claim", section: sectionName, claim, explanation: "A planned or launched release is dated after the reporting period and cannot establish shipped-this-period." });
                    }
                }
            }
        }
        if (section && typeof section === "object" && "state" in section && section.state === "no_evidence" && "items" in section) failures.push({ category: "invalid_empty_section", section: sectionName, explanation: "No-evidence sections must not include items." });
    }
    const hard = failures.some(failure => ["malformed_payload", "invalid_citation", "invalid_source_type", "unsupported_shipped_claim", "future_release_claim", "invalid_empty_section"].includes(failure.category));
    const qualityEvidence = evidenceSnapshot.items.filter(item => item.sourceType === "document_change" || item.sourceType === "customer_feedback");
    return { passed: failures.length === 0, hasHardFailure: hard, deterministic: { canonicalSchemaValid, citationValidity: citations ? validCitations / citations : 1, citationCoverage: claimCount ? citedClaims / claimCount : 1, sourceSemanticViolationRate: semanticChecks ? semanticViolations / semanticChecks : 0, unsupportedClaimRate: supportChecks ? unsupported / supportChecks : 0, unsupportedShippedClaimRate: shippedChecks ? unsupportedShipped / shippedChecks : 0, duplicateClaimRate: claimCount ? duplicateClaims / claimCount : 0, evidenceCoverage: qualityEvidence.length ? qualityEvidence.filter(item => covered.has(item.sourceId)).length / qualityEvidence.length : 1, emptySectionCorrectness: failures.some(failure => failure.category === "invalid_empty_section") ? 0 : 1 }, failures };
}
