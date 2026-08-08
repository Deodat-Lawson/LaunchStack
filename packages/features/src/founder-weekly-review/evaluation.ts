import{
  type FounderWeeklyReviewEvidenceSnapshot,
  type FounderWeeklyReviewPayload,
  FounderWeeklyReviewV2PayloadSchema,
} from "./contracts";

export interface EvaluationResult {
  passed: boolean;

  hasHardFailure: boolean;

  deterministic: {
    canonicalSchemaValid: boolean;
    citationValidity: number;
    citationCoverage: number;
    unsupportedClaimRate: number;
    unsupportedShippedClaimRate: number;
    sourceTypeViolationRate: number;
    evidenceCoverage: number;
    materialityScore: number;
    duplicateClaimRate: number;
    emptySectionCorrectness: number;
  };

  overallScore: number;

  failures: EvaluationFailure[];
}

export type EvaluationFailure = {
  category: string;
  section?: string;
  claim?: string;
  explanation: string;
};

const monthNumbers: Record<string, number> = { 
  january: 1, 
  february: 2, 
  march: 3, 
  april: 4, 
  may: 5, 
  june: 6, 
  july: 7, 
  august: 8, 
  september: 9, 
  october: 10, 
  november: 11, 
  december: 12 
};

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

const SECTION_SOURCE_RULES: Record<string, string[]> = {
  whatCustomersSaid: ["customer_feedback"],
  whatChanged: [
    "document_change",
    "workspace_document",
    "github_activity",
    "founder_context",
  ],
  whatShipped: [
    "github_activity",
    "document_change",
    "workspace_document",
  ],
  currentBlockers: [
    "founder_context",
    "workspace_document",
    "github_activity",
  ],
  nextPriorities: [
    "founder_context",
    "workspace_document",
  ],
};

type EvidenceSourceType =
  FounderWeeklyReviewEvidenceSnapshot["items"][number]["sourceType"];

function isValidSourceForSection(
  sectionName: string,
  sourceType: EvidenceSourceType
) {
  const allowed = SECTION_SOURCE_RULES[sectionName];

  if (!allowed) return true;

  return allowed.includes(sourceType);
}

function getSectionItems(section: unknown): unknown[] {
  if (typeof section !== "object" || section === null) {
    return [];
  }

  if (
    "items" in section &&
    Array.isArray(section.items)
  ) {
    return section.items;
  }

  return [];
}

function getItemKind(item: unknown): string | undefined {
  if (
    typeof item === "object" &&
    item !== null &&
    "kind" in item &&
    typeof item.kind === "string"
  ) {
    return item.kind;
  }

  return undefined;
}

function normalizeClaim(text:string) {
  return text
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g," ")
    .trim();
}

function claimSupportedByEvidence(
  claim: string,
  evidenceText: string
) {
  const claimWords = new Set(
    normalizeClaim(claim)
      .split(" ")
      .filter(word => word.length > 3)
  );

  const evidenceWords = new Set(
    normalizeClaim(evidenceText)
      .split(" ")
      .filter(word => word.length > 3)
  );

  const overlap = [...claimWords].filter(word =>
    evidenceWords.has(word)
  );

  return overlap.length >= 2;
}

function evaluateEmptySections(
  evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot,
  report: FounderWeeklyReviewPayload,
  failures: EvaluationFailure[]
): number {
  if (evidenceSnapshot.items.length !== 0) return 1; 

  let incorrect = 0;

  for (const [sectionName, section] of Object.entries(report.sections)) {
    if (section.state !== "no_evidence") {
      incorrect++;

      failures.push({
        category: "invalid_empty_section",
        section: sectionName,
        explanation:
          "Empty evidence snapshot must produce no_evidence sections.",
      });
    }
  }

  return incorrect === 0 ? 1 : 0;
}

function evidenceIndicatesShipped(
  evidence: FounderWeeklyReviewEvidenceSnapshot["items"][number]
) {
  const text = normalizeClaim(
    `${evidence.title} ${evidence.excerpt}`
  );

  return [
    "released",
    "deployed",
    "launched",
    "shipped",
    "merged",
    "implemented",
    "completed"
  ].some(keyword => text.includes(keyword));
}

function evidenceConflicts(
  evidenceItems: FounderWeeklyReviewEvidenceSnapshot["items"][number][]
) {
  const texts = evidenceItems.map(e =>
    normalizeClaim(`${e.title} ${e.excerpt}`)
  );

  const supporting = texts.some(text =>
    [
      "want",
      "requested",
      "needs",
      "need",
    ].some(keyword => text.includes(keyword))
  );

  const opposing = texts.some(text =>
    [
      "unnecessary",
      "does not need",
      "doesn't need",
      "don't need",
      "not needed",
    ].some(keyword => text.includes(keyword))
  );

  return supporting && opposing;
}

function isTemporalChangeClaim(text: string): boolean {
  const lower = text.toLowerCase();

  const changeLanguage =
    /\b(changed|updated|modified|added|removed|introduced)\b/.test(lower);

  const temporalLanguage =
    /\b(this week|this period|during the reporting period|during this period|recently)\b/.test(
      lower
    );

  return changeLanguage && temporalLanguage;
}

export function evaluateFounderWeeklyReview(
  evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot,
  report: FounderWeeklyReviewPayload,
): EvaluationResult {
  const failures: EvaluationFailure[] = [];

  const evidenceById = new Map(
    evidenceSnapshot.items.map((item) => [
      item.sourceId,
      item,
    ])
  );

  const claims = new Set<string>();

  let totalCitations = 0;
  let validCitations = 0;

  let totalClaimsWithCitationIds = 0;
  let totalClaimsRequiringCitation = 0;

  let sourceTypeViolations = 0;
  let totalSourceTypeChecks = 0;

  let emptySectionCorrectness = 1;

  let unsupportedClaims = 0;
  let unsupportedClaimChecks = 0;

  let unsupportedShippedClaims = 0;
  let shippedClaimChecks = 0;

  let canonicalSchemaValid = true;

  try {
    FounderWeeklyReviewV2PayloadSchema.parse(report);
  } catch {
    canonicalSchemaValid = false;

    failures.push({
      category:"malformed_payload",
      explanation:
        "Report does not satisfy Founder Weekly Review V2 schema.",
    });
  }

  if (!canonicalSchemaValid) {
    return {
      passed: false,
      hasHardFailure: true,
      deterministic: {
        canonicalSchemaValid,
        citationValidity: 0,
        citationCoverage: 0,
        unsupportedShippedClaimRate: 0,
        unsupportedClaimRate: 0,
        sourceTypeViolationRate: 0,
        evidenceCoverage: 0,
        materialityScore: 0,
        duplicateClaimRate: 0,
        emptySectionCorrectness,
      },
      overallScore: 0,
      failures,
    };
  }

  emptySectionCorrectness = evaluateEmptySections(
    evidenceSnapshot,
    report,
    failures
  );

  const reportClaims = new Set<string>();

  const citedEvidenceIds = new Set<string>();

  for (const [sectionName, section] of Object.entries(report.sections)) {
    for (const item of getSectionItems(section)) {
      const text = typeof item === "object" && 
        item !== null && 
        "text" in item && 
        typeof item.text === "string" 
          ? normalizeClaim(item.text)
          : null;
          
      if (text) {
        reportClaims.add(text);
        if (claims.has(text)) {
          failures.push({
            category: "duplicate_claim",
            section: sectionName,
            claim: text,
            explanation: "Same factual claim appears multiple times.",
          });
        }
        claims.add(text);
      }

      if (
        typeof item === "object" &&
        item !== null &&
        "kind" in item
      ) {
        const kind = getItemKind(item);
        if (
          kind === "observed_fact" ||
          kind === "contradictory_evidence" ||
          kind === "recommendation"
          ) {
          totalClaimsRequiringCitation++;
          if (
            "sourceIds" in item &&
            Array.isArray(item.sourceIds) &&
            item.sourceIds.length > 0
          ) {
            totalClaimsWithCitationIds++;
          }
        }
      }
        
      if (
        typeof item === "object" &&
        item !== null &&
        "sourceIds" in item &&
        Array.isArray(item.sourceIds)
      ) {

        for (const sourceId of item.sourceIds) {
          citedEvidenceIds.add(sourceId);
          const evidence = evidenceById.get(sourceId);

          if (evidence) {
            totalSourceTypeChecks++;
          
            if (
              sectionName === "whatChanged" &&
              typeof item === "object" &&
              item !== null &&
              "text" in item &&
              typeof item.text === "string" &&
              isTemporalChangeClaim(item.text) &&
              evidence.sourceType === "workspace_document"
            ) {
              sourceTypeViolations++;

              failures.push({
                category: "invalid_source_type",
                section: sectionName,
                claim: item.text,
                explanation:
                  "A workspace document can establish current document context, but cannot by itself establish that a change occurred during the reporting period.",
              });
            } else if (!isValidSourceForSection(sectionName, evidence.sourceType)) {
              sourceTypeViolations++;

              failures.push({
                category: "invalid_source_type",
                section: sectionName,
                explanation: `Source type "${evidence.sourceType}" is not valid for section "${sectionName}"`,
              });
            }

            if (
              sectionName === "whatShipped" &&
              typeof item === "object" &&
              item !== null &&
              "text" in item &&
              typeof item.text === "string"
            ) {
              shippedClaimChecks++;

              if (
                evidence.sourceType === "document_change" &&
                futureReleaseMentioned(
                  `${item.text} ${evidence.title} ${evidence.excerpt}`,
                  evidenceSnapshot.reportingPeriod.end
                )
              ) {
                failures.push({
                  category: "future_release_claim",
                  section: sectionName,
                  claim: item.text,
                  explanation:
                    "A planned or launched release is dated after the reporting period and cannot establish shipped-this-period.",
                });
              }
              
              if (
                ["github_activity", "document_change", "workspace_document"].includes(evidence.sourceType) &&
                !evidenceIndicatesShipped(evidence)
              ) {
                unsupportedShippedClaims++;

                failures.push({
                  category: "unsupported_shipped_claim",
                  section: sectionName,
                  claim: item.text,
                  explanation:
                    "Evidence does not contain a shipping signal.",
                });
              }
            }
          }

          totalCitations++;
          if (evidenceById.has(sourceId)) {
            validCitations++;
          } else {
            failures.push({
            category: "invalid_citation",
            section: sectionName,
            explanation: `Unknown sourceId: ${sourceId}`,
            });
          }
        }
        if (
          typeof item === "object" &&
          item !== null &&
          "text" in item &&
          typeof item.text === "string"
        ) {

          const kind = getItemKind(item);

          if (kind !== "recommendation" && 
            kind !== "contradictory_evidence" &&
            sectionName !== "whatShipped") {
            unsupportedClaimChecks++;
          
            const citedEvidence = item.sourceIds
              .map((id:string) => evidenceById.get(id))
              .filter(
                (e): e is FounderWeeklyReviewEvidenceSnapshot["items"][number] =>
                  Boolean(e)
              );

            const combinedEvidenceText = citedEvidence
              .map(e => `${e.title} ${e.excerpt}`)
              .join(" ");

            if (
              citedEvidence.length > 1 &&
              evidenceConflicts(citedEvidence)
            ) {
              failures.push({
                category: "conflicting_evidence",
                section: sectionName,
                claim: item.text,
                explanation:
                  "Claim ignores conflicting cited evidence.",
              });
            } else if (
              citedEvidence.length > 0 &&
              !claimSupportedByEvidence(
                item.text,
                combinedEvidenceText
              )
            ) {
              unsupportedClaims++;

              failures.push({
                category: "unsupported_claim",
                section: sectionName,
                claim: item.text,
                explanation:
                  "Claim is not directly supported by cited evidence.",
              });
            }
          }
        }
      }
    }
  }

  const citationValidity =
    totalCitations === 0
      ? 1
      : validCitations / totalCitations;

  const citationCoverage =
    totalClaimsRequiringCitation === 0
      ? 1
      : totalClaimsWithCitationIds / totalClaimsRequiringCitation;

  const sourceTypeViolationRate =
    totalSourceTypeChecks === 0
      ? 0
      : sourceTypeViolations / totalSourceTypeChecks;

  const hasHardFailure = failures.some((f) =>
    [ // duplicate_claim not included: more of a quality issue
      "malformed_payload", 
      "invalid_citation", 
      "invalid_source_type",
      "unsupported_shipped_claim",
      "future_release_claim",
      "invalid_empty_section",
      "conflicting_evidence"
    ].includes(f.category)
  );

  const coveredEvidence =
    evidenceSnapshot.items.filter((evidence) =>
      citedEvidenceIds.has(evidence.sourceId)
    ).length;

  const evidenceCoverage =
    evidenceSnapshot.items.length === 0
      ? 1
      : coveredEvidence / evidenceSnapshot.items.length;

  const materialEvidence = evidenceSnapshot.items.filter(
    (evidence) =>
      [
        "github_activity",
        "document_change",
        "founder_context",
        "workspace_document",
      ].includes(evidence.sourceType)
  );


  const materialEvidenceCovered =
    materialEvidence.filter((evidence) =>
      citedEvidenceIds.has(evidence.sourceId)
    ).length;


  const materialityScore =
    materialEvidence.length === 0
      ? 1
      : materialEvidenceCovered / materialEvidence.length;
      

  const overallScore = hasHardFailure 
    ? 0 
    : citationValidity * 0.25 +
      citationCoverage * 0.15 +
      evidenceCoverage * 0.25 +
      materialityScore * 0.15 +
      (1 - sourceTypeViolationRate) * 0.20;

  return {
    passed: failures.length === 0,

    hasHardFailure,

    deterministic: {
      canonicalSchemaValid,
      citationValidity,
      citationCoverage,
      unsupportedClaimRate:
        unsupportedClaimChecks === 0
          ? 0
          : unsupportedClaims / unsupportedClaimChecks,

      unsupportedShippedClaimRate:
        shippedClaimChecks === 0
          ? 0
          : unsupportedShippedClaims / shippedClaimChecks,
      sourceTypeViolationRate,
      evidenceCoverage,
      materialityScore,
      duplicateClaimRate:
        claims.size === 0
          ? 0
          : Math.min(
              1,
              failures.filter(
                (f) => f.category === "duplicate_claim"
              ).length / claims.size
            ),
      emptySectionCorrectness,
    },

    overallScore,

    failures,
  };
}