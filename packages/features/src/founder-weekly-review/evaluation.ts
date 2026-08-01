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

const SECTION_SOURCE_RULES: Record<string, string[]> = {
  whatCustomersSaid: ["customer_feedback"],
  whatChanged: [
    "document_change",
    "workspace_document",
    "github_activity",
  ],
  whatShipped: [
    "github_activity",
    "document_change",
  ],
  currentBlockers: [
    "founder_context",
    "manual_note",
  ],
  nextPriorities: [
    "founder_context",
    "manual_note",
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
        sourceTypeViolationRate: 1,
        evidenceCoverage: 0,
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
          
          const evidence = evidenceById.get(sourceId);

          if (evidence) {
            totalSourceTypeChecks++;
          
            if(!isValidSourceForSection(sectionName, evidence.sourceType)) {
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

              if (!evidenceIndicatesShipped(evidence)) {
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
      "invalid_empty_section",
      "conflicting_evidence"
    ].includes(f.category)
  );

  const coveredEvidence =
    evidenceSnapshot.items.filter((evidence) => {
      const evidenceText = normalizeClaim(
        `${evidence.title} ${evidence.excerpt}`);

      return [...reportClaims].some((claim) =>
        claimSupportedByEvidence(claim, evidenceText)
      );
    }).length;

  const evidenceCoverage =
    evidenceSnapshot.items.length === 0
      ? 1
      : coveredEvidence / evidenceSnapshot.items.length;

  const overallScore = hasHardFailure 
    ? 0 
    : citationValidity * 0.30 +
      citationCoverage * 0.20 +
      evidenceCoverage * 0.30 +
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