import {
  FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
  FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
  FounderWeeklyReviewV2Payload,
  type FounderWeeklyReviewEvidenceSnapshot,
} from "../contracts";

export type BenchmarkCase = {
  id: string;
  description: string;
  runThroughGeneration: boolean;
  evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
  generatedReport?: FounderWeeklyReviewV2Payload;

  expectations: {
    shouldPass: boolean;
    requiredClaims?: string[];
    forbiddenClaims?: string[];
    expectedEmptySections?: string[];
    expectedFailureCategories?: string[];
  };
};

const noEvidenceSection = {
  state: "no_evidence" as const,
  noEvidence: {
    code: "none",
    message: "No evidence available.",
    cta: "Add evidence.",
  },
};

const validEvidence = {
  schemaVersion: FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
  capturedAt: "2026-07-01T00:00:00.000Z",
  reportingPeriod: {
    start: "2026-07-01",
    end: "2026-07-07",
  },
  workspaceTimezone: "America/New_York",
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_1",
      title: "Customer requested export feature",
      excerpt: "Customer asked for CSV export.",
      metadata: {},
    },
  ],
  sourceWarnings: [],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const emptyEvidence = {
  ...validEvidence,
  items: [],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const founderContextEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "founder_context",
      sourceId: "context_1",
      title: "Founder notes",
      excerpt: "Founder heard customers asking for export.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const founderContextOnlyEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "founder_context",
      sourceId: "context_1",
      title: "Founder priorities",
      excerpt: "Founder wants to improve onboarding.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const multipleCustomerEvidence = {
  ...validEvidence,
  items: [
    ...validEvidence.items,
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_2",
      title: "Second customer",
      excerpt: "Another customer requested CSV export.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const completeEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_1",
      title: "Customer request",
      excerpt: "Customer requested CSV export.",
      metadata: {},
    },
    {
      sourceType: "github_activity",
      sourceId: "github_1",
      title: "Released export feature",
      excerpt: "CSV export was shipped.",
      metadata: {},
    },
    {
      sourceType: "founder_context",
      sourceId: "context_1",
      title: "Founder priorities",
      excerpt: "Focus on improving onboarding.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const multipleThemeEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_1",
      title: "Export request",
      excerpt: "Customer requested CSV export.",
      metadata: {},
    },
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_2",
      title: "Onboarding complaint",
      excerpt: "Customer reported onboarding was confusing.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const weakEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_1",
      title: "Feature request",
      excerpt: "Customer requested CSV export.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const weakCustomerSignalEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_weak",
      title: "Customer feedback",
      excerpt: "Customer asked if CSV export could be added.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const conflictingCustomerFeedbackEvidence = {
  ...validEvidence,
  items:[
    {
      sourceType:"customer_feedback",
      sourceId:"feedback_1",
      title:"Customer wants export",
      excerpt:"Customer requested CSV export.",
      metadata:{},
    },
    {
      sourceType:"customer_feedback",
      sourceId:"feedback_2",
      title:"Customer does not need export",
      excerpt:"Customer said CSV export is unnecessary.",
      metadata:{},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const validContradictoryEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_1",
      title: "Customer wants export",
      excerpt: "Customer requested CSV export.",
      metadata: {},
    },
    {
      sourceType: "customer_feedback",
      sourceId: "feedback_2",
      title: "Customer does not need export",
      excerpt: "Customer said CSV export is unnecessary.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const documentChangeEvidence = {
 ...validEvidence,
 items:[
  {
   sourceType:"document_change",
   sourceId:"docs_1",
   title:"Updated README",
   excerpt:"README updated with export instructions.",
   metadata:{},
  },
 ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const workspaceDocumentEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "workspace_document",
      sourceId: "workspace_doc_1",
      title: "Onboarding Plan",
      excerpt: "Platform owns retry telemetry.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const unavailableSourceEvidence = {
 ...validEvidence,
 items:[
  {
   sourceType:"customer_feedback",
   sourceId:"feedback_missing",
   title:"Unavailable feedback",
   excerpt:"Source unavailable.",
   metadata:{},
  },
 ],
 sourceWarnings:[
  {
   code:"source_unavailable",
   message:"Source unavailable",
   sourceType:"customer_feedback",
  },
 ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const plannedWorkEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "document_change",
      sourceId: "plan_doc_1",
      title: "Launch Plan",
      excerpt: "CSV export is planned for next sprint. Implementation has not started yet.",
      metadata: {
        changeType: "modified",
      },
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;


const validDocumentChangeEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "document_change",
      sourceId: "document_change_1",
      title: "Onboarding Plan",
      excerpt: "Ownership changed from Product to Platform.",
      metadata: {
        previousVersionId: "v1",
        currentVersionId: "v2",
        previousChunkId: "chunk_101",
        currentChunkId: "chunk_202",
        changeType: "modified",
      },
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;


const multipleVersionChangeEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "document_change",
      sourceId: "document_change_v1_v2",
      title: "Reliability Plan",
      excerpt: "Retry ownership moved to Platform.",
      metadata: {
        previousVersionId: "v1",
        currentVersionId: "v2",
        previousChunkId: "chunk_101",
        currentChunkId: "chunk_202",
        changeType: "modified",
      },
    },
    {
      sourceType: "document_change",
      sourceId: "document_change_v2_v3",
      title: "Reliability Plan",
      excerpt: "Monitoring requirements were added.",
      metadata: {
        previousVersionId: "v2",
        currentVersionId: "v3",
        previousChunkId: "chunk_202",
        currentChunkId: "chunk_303",
        changeType: "modified",
      },
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const meaningfulChangeEvidence = {
  ...validEvidence,
  items: [
    {
      sourceType: "document_change",
      sourceId: "change_1",
      title: "Retry ownership update",
      excerpt: "Ownership moved from Product to Platform.",
      metadata: {},
    },
  ],
} satisfies FounderWeeklyReviewEvidenceSnapshot;

const validReport = {
  schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
  sections: {
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "A customer requested CSV export.",
          sourceIds: ["feedback_1"],
          confidence: 0.9,
        },
      ],
    },

    whatChanged: {
      state: "no_evidence",
      noEvidence: {
        code: "no_change_reported",
        message: "No changes were reported for this period.",
        cta: "Check with the team if there were any internal changes.",
      },
    },

    whatShipped: {
      state: "no_evidence",
      noEvidence: {
        code: "nothing_shipped",
        message: "No shipped work was reported this period.",
        cta: "Confirm release notes or deployment logs.",
      },
    },

    currentBlockers: {
      state: "no_evidence",
      noEvidence: {
        code: "no_blockers",
        message: "No current blockers were reported.",
        cta: "Reach out if any impediments arise.",
      },
    },

    nextPriorities: {
      state: "no_evidence",
      noEvidence: {
        code: "no_priorities",
        message: "No next priorities were specified.",
        cta: "Discuss upcoming focuses with the team.",
      },
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const invalidCitationReport = ({
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "A customer requested CSV export.",
          sourceIds: ["fake_feedback_999"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload);

const emptyReport = {
  schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
  sections: {
    whatCustomersSaid: noEvidenceSection,
    whatChanged: noEvidenceSection,
    whatShipped: noEvidenceSection,
    currentBlockers: noEvidenceSection,
    nextPriorities: noEvidenceSection,
  },
} satisfies FounderWeeklyReviewV2Payload;

const missingCitationReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "A customer requested CSV export.",
          sourceIds: ["missing_source"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const founderContextCustomerReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Customers requested export.",
          sourceIds: ["context_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const founderContextOnlyReport = {
  ...emptyReport,
  sections: {
    ...emptyReport.sections,

    nextPriorities: {
      state: "evidence",
      items: [
        {
          kind: "recommendation",
          text: "Improve onboarding.",
          sourceIds: ["context_1"],
          confidence: 0.9,
          label: "Recommendation",
          rationale: null,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const multiSourceReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Multiple customers requested CSV export.",
          sourceIds: [
            "feedback_1",
            "feedback_2",
          ],
          confidence: 0.95,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const completeReport = {
  ...validReport,
  sections: {
    ...validReport.sections,

    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Customer requested CSV export.",
          sourceIds: ["feedback_1"],
          confidence: 0.9,
        },
      ],
    },

    whatShipped: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "CSV export was shipped.",
          sourceIds: ["github_1"],
          confidence: 0.9,
        },
      ],
    },

    nextPriorities: {
      state: "evidence",
      items: [
        {
          kind: "recommendation",
          text: "Improve onboarding.",
          sourceIds: ["context_1"],
          confidence: 0.9,
          label: "Recommendation",
          rationale: null,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;


const duplicateClaimsReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state:"evidence",
      items:[
        {
        kind:"observed_fact",
        text:"Customer requested CSV export.",
        sourceIds:["feedback_1"],
        confidence:0.8,
        }
      ]
      },

      whatChanged:{
      state:"evidence",
      items:[
        {
        kind:"observed_fact",
        text:"Customer requested CSV export.",
        sourceIds:["feedback_1"],
        confidence:0.8,
        }
      ]
      }
  }
} satisfies FounderWeeklyReviewV2Payload;

const duplicateSourcesReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Multiple customers requested CSV export.",
          sourceIds: [
            "feedback_1",
            "feedback_1",
          ],
          confidence: 0.95,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const unsupportedShippedReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatShipped: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "CSV export was shipped.",
          sourceIds: ["feedback_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const malformedReport = {
  schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
  sections: {
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "invalid_kind" as any,
          text: "Invalid item kind.",
          sourceIds: ["feedback_1"],
          confidence: 0.9,
        },
      ],
    },
    whatChanged: noEvidenceSection,
    whatShipped: noEvidenceSection,
    currentBlockers: noEvidenceSection,
    nextPriorities: noEvidenceSection,
  },
} as unknown as FounderWeeklyReviewV2Payload;

const omittedEvidenceReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Customer requested CSV export.",
          sourceIds: ["feedback_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const exaggeratedClaimReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid:{
      state:"evidence",
      items:[
        {
          kind:"observed_fact",
          text:"Customers cannot use the product without CSV export.",
          sourceIds:["feedback_1"],
          confidence:0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const weakSynthesisReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "CSV export is a major customer pain point affecting adoption.",
          sourceIds: ["feedback_weak"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const conflictingEvidenceReport = {
 ...validReport,
 sections:{
   ...validReport.sections,
   whatCustomersSaid:{
    state:"evidence",
    items:[
      {
       kind:"observed_fact",
       text:"All customers want CSV export.",
       sourceIds:[
        "feedback_1",
        "feedback_2",
       ],
       confidence:0.95,
      },
    ],
   },
 },
} satisfies FounderWeeklyReviewV2Payload;

const validContradictoryEvidenceReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "contradictory_evidence",
          text: "Customers have mixed opinions about CSV export. One customer requested it while another said it was unnecessary.",
          sourceIds: [
            "feedback_1",
            "feedback_2",
          ],
          confidence: 0.95,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const documentChangeShippedReport = {
 ...emptyReport,
 sections:{
  ...emptyReport.sections,
  whatShipped:{
   state:"evidence",
   items:[
    {
     kind:"observed_fact",
     text:"CSV export was shipped.",
     sourceIds:["docs_1"],
     confidence:0.9,
    },
   ],
  },
 },
} satisfies FounderWeeklyReviewV2Payload;

const documentChangeCustomerReport = {
  ...validReport,
  sections:{
    ...validReport.sections,
    whatCustomersSaid:{
      state:"evidence",
      items:[
        {
          kind:"observed_fact",
          text:"Customers requested export.",
          sourceIds:["docs_1"],
          confidence:0.9,
        }
      ]
    }
  }
} satisfies FounderWeeklyReviewV2Payload;

const workspaceDocumentAsCustomerReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Customers requested better onboarding.",
          sourceIds: ["workspace_doc_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const unavailableSourceSafeReport = {
 ...emptyReport,
} satisfies FounderWeeklyReviewV2Payload;

const plannedWorkMarkedShippedReport = {
  ...emptyReport,
  sections: {
    ...emptyReport.sections,
    whatShipped: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "CSV export shipped.",
          sourceIds: ["plan_doc_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;


const validDocumentChangeReport = {
  ...emptyReport,
  sections: {
    ...emptyReport.sections,
    whatChanged: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Ownership changed from Product to Platform.",
          sourceIds: ["document_change_1"],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;


const multipleVersionChangeReport = {
  ...emptyReport,
  sections: {
    ...emptyReport.sections,
    whatChanged: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "Retry ownership moved to Platform and monitoring requirements were added.",
          sourceIds: [
            "document_change_v1_v2",
            "document_change_v2_v3",
          ],
          confidence: 0.9,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

const vagueSummaryReport = {
  ...validReport,
  sections: {
    ...validReport.sections,
    whatCustomersSaid: {
      state: "no_evidence",
      noEvidence: {
        code: "no_customer_feedback",
        message: "No customer feedback was reported.",
        cta: "Collect customer feedback.",
      },
    },
    whatChanged: {
      state: "evidence",
      items: [
        {
          kind: "observed_fact",
          text: "There was a change related to retry ownership.",
          sourceIds: ["change_1"],
          confidence: 0.8,
        },
      ],
    },
  },
} satisfies FounderWeeklyReviewV2Payload;

export const benchmarkCases: BenchmarkCase[] = [
  {
    id: "valid_customer_feedback_report",
    runThroughGeneration: true,
    description: "A report with valid customer feedback citation",
    evidenceSnapshot: validEvidence,
    generatedReport: validReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "invalid_citation_report",
    runThroughGeneration: false,
    description: "A report citing evidence that does not exist",
    evidenceSnapshot: validEvidence,
    generatedReport: invalidCitationReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "invalid_citation",
      ],
    },
  },

  {
    id: "empty_workspace",
    runThroughGeneration: true,
    description: "No evidence produces an all no_evidence report.",
    evidenceSnapshot: emptyEvidence,
    generatedReport: emptyReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "complete_workspace",
    runThroughGeneration: true,
    description: "Workspace has complete evidence coverage across sections.",
    evidenceSnapshot: completeEvidence,
    generatedReport: completeReport,
    expectations: {
      shouldPass: true,
    }
  },

  {
    id: "partial_workspace",
    runThroughGeneration: true,
    description: "Workspace has some evidence but not every section.",
    evidenceSnapshot: validEvidence,
    generatedReport: validReport,
    expectations:{
      shouldPass:true,
    },
  },

  {
    id: "invalid_missing_source_citation",
    runThroughGeneration: false,
    description: "Observed fact references a missing evidence source.",
    evidenceSnapshot: validEvidence,
    generatedReport: missingCitationReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "invalid_citation",
      ],
    },
  },

  {
    id: "founder_context_as_customer_feedback",
    runThroughGeneration: false,
    description: "Founder context is cited as customer feedback.",
    evidenceSnapshot: founderContextEvidence,
    generatedReport: founderContextCustomerReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "invalid_source_type",
      ],
    },
  },

  {
    id: "founder_context_only_valid",
    runThroughGeneration: true,
    description: "Founder context can support recommendations when used in the correct section.",
    evidenceSnapshot: founderContextOnlyEvidence,
    generatedReport: founderContextOnlyReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "multi_source_customer_feedback",
    runThroughGeneration: true,
    description: "Customer feedback cites multiple sources.",
    evidenceSnapshot: multipleCustomerEvidence,
    generatedReport: multiSourceReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "duplicate_customer_claims",
    runThroughGeneration: false,
    description: "Report contains duplicate claims across sections.",
    evidenceSnapshot: validEvidence,
    generatedReport: duplicateClaimsReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "duplicate_claim"
      ]
    }
  },

  {
    id: "duplicate_source_ids_schema_validation",
    runThroughGeneration: false,
    description: "Schema rejects reports with duplicate source IDs.",
    evidenceSnapshot: validEvidence,
    generatedReport: duplicateSourcesReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "malformed_payload"
      ]
    }
  },

  {
    id: "unsupported_shipped_claim",
    runThroughGeneration: false,
    description: "Customer feedback cannot prove shipped work.",
    evidenceSnapshot: validEvidence,
    generatedReport: unsupportedShippedReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "invalid_source_type",
      ],
    },
  },

  {
    id: "malformed_payload",
    runThroughGeneration: false,
    description: "Report does not satisfy schema.",
    evidenceSnapshot: validEvidence,
    generatedReport: malformedReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "malformed_payload",
      ],
    },
  },

  {
    id: "evidence_omitted",
    runThroughGeneration: false,
    description: "Report ignores a major evidence theme.",
    evidenceSnapshot: multipleThemeEvidence,
    generatedReport: omittedEvidenceReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id:"exaggerated_claim",
    runThroughGeneration: false,
    description:"Report makes a stronger claim than evidence supports.",
    evidenceSnapshot:weakEvidence,
    generatedReport:exaggeratedClaimReport,
    expectations:{
      shouldPass:false,
      expectedFailureCategories:[
        "unsupported_claim",
      ],
    },
  },

  {
    id: "weak_customer_signal_overstated",
    runThroughGeneration: false,
    description:
      "Report overstates a small customer signal into a major business conclusion.",
    evidenceSnapshot: weakCustomerSignalEvidence,
    generatedReport: weakSynthesisReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id:"conflicting_evidence",
    runThroughGeneration: false,
    description:"Report ignores conflicting evidence.",
    evidenceSnapshot:conflictingCustomerFeedbackEvidence,
    generatedReport:conflictingEvidenceReport,
    expectations:{
      shouldPass:false,
      expectedFailureCategories:[
        "conflicting_evidence",
      ],
    },
  },

  {
    id:"document_change_as_shipped",
    runThroughGeneration: false,
    description:"Documentation updates cannot prove shipped features.",
    evidenceSnapshot:documentChangeEvidence,
    generatedReport:documentChangeShippedReport,
    expectations:{
      shouldPass:false,
      expectedFailureCategories:[
      "unsupported_shipped_claim",
      ],
    },
  },

  {
    id:"document_change_as_customer_feedback",
    runThroughGeneration:false,
    description:"Document changes cannot represent customer feedback.",
    evidenceSnapshot:documentChangeEvidence,
    generatedReport:documentChangeCustomerReport,
    expectations:{
      shouldPass:false,
      expectedFailureCategories:[
        "invalid_source_type"
      ]
    }
  },

  {
    id: "workspace_document_as_customer_feedback",
    runThroughGeneration: false,
    description: "Workspace documents cannot be used as customer feedback.",
    evidenceSnapshot: workspaceDocumentEvidence,
    generatedReport: workspaceDocumentAsCustomerReport,
    expectations: {
      shouldPass: false,
      expectedFailureCategories: [
        "invalid_source_type",
      ],
    },
  },

  {
    id:"unavailable_source_warning",
    runThroughGeneration: true,
    description:"Unavailable evidence should not force hallucination.",
    evidenceSnapshot:unavailableSourceEvidence,
    generatedReport:unavailableSourceSafeReport,
    expectations:{
      shouldPass:true,
    },
  },

  {
    id: "valid_contradictory_evidence",
    runThroughGeneration: true,
    description: "Report correctly represents conflicting evidence.",
    evidenceSnapshot: validContradictoryEvidence,
    generatedReport: validContradictoryEvidenceReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "planned_work_marked_as_shipped",
    runThroughGeneration: false,
    description: "Planned document work cannot be represented as shipped work.",
    evidenceSnapshot: plannedWorkEvidence,
    generatedReport: plannedWorkMarkedShippedReport,
    expectations: {
      shouldPass: false,
      forbiddenClaims: [
        "CSV export shipped",
      ],
      expectedFailureCategories: [
        "unsupported_shipped_claim",
      ],
    },
  },

  {
    id: "valid_document_change_evidence",
    runThroughGeneration: false,
    description: "Document changes can support what changed when properly cited.",
    evidenceSnapshot: validDocumentChangeEvidence,
    generatedReport: validDocumentChangeReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "multiple_adjacent_version_changes",
    runThroughGeneration: false,
    description: "Multiple document versions in a reporting period should preserve adjacent changes.",
    evidenceSnapshot: multipleVersionChangeEvidence,
    generatedReport: multipleVersionChangeReport,
    expectations: {
      shouldPass: true,
    },
  },

  {
    id: "low_materiality_summary",
    runThroughGeneration: false,
    description:
      "Report cites evidence but provides a vague low-value summary.",
    evidenceSnapshot: meaningfulChangeEvidence,
    generatedReport: vagueSummaryReport,
    expectations: {
      shouldPass: true,
    },
  },
];