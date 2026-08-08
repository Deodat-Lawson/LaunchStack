import type {
    DocumentChangeCategory,
    VersionChunk,
} from "@launchstack/features/founder-weekly-review";

export type ExpectedAlignmentRelation = {
    id: string;
    relation: "modified" | "unchanged" | "added" | "removed" | "split" | "merge";
    previousChunkIds: readonly number[];
    currentChunkIds: readonly number[];
};

export type ExpectedChange = {
    id: string;
    material: boolean;
    category: DocumentChangeCategory | null;
    previousChunkIds: readonly number[];
    currentChunkIds: readonly number[];
};

export type ExpectedNoOp = {
    id: string;
    previousChunkId: number;
    currentChunkId: number;
};

export type MaterialityEvaluationScenario = {
    id: string;
    description: string;
    documentKind: string;
    multiChunk: boolean;
    largeDocument: boolean;
    previousChunks: readonly VersionChunk[];
    currentChunks: readonly VersionChunk[];
    expected: {
        meaningfulChanges: readonly ExpectedChange[];
        nonMaterialChanges: readonly ExpectedChange[];
        expectedNoOps: readonly ExpectedNoOp[];
        expectedAlignmentRelations: readonly ExpectedAlignmentRelation[];
    };
};

type ChunkSpec = {
    key: string;
    content: string;
    path?: string | null;
    title?: string | null;
    order?: number;
    page?: number;
};

type ChangeSpec = {
    id: string;
    material: boolean;
    category: DocumentChangeCategory | null;
    previousKeys: readonly string[];
    currentKeys: readonly string[];
};

type RelationSpec = {
    id: string;
    relation: ExpectedAlignmentRelation["relation"];
    previousKeys: readonly string[];
    currentKeys: readonly string[];
};

type ScenarioSpec = {
    id: string;
    description: string;
    documentKind: string;
    previous: readonly ChunkSpec[];
    current: readonly ChunkSpec[];
    changes?: readonly ChangeSpec[];
    noOps?: readonly { id: string; previousKey: string; currentKey: string }[];
    relations: readonly RelationSpec[];
    largeDocument?: boolean;
};

function chunk(
    scenarioOrdinal: number,
    version: 1 | 2,
    index: number,
    spec: ChunkSpec
): VersionChunk {
    const documentId = BigInt(10_000 + scenarioOrdinal);
    return {
        chunkId: scenarioOrdinal * 1_000 + (version === 1 ? index + 1 : index + 501),
        content: spec.content,
        contentHash: null,
        structureId: null,
        structurePath: spec.path ?? `/section/${spec.key}`,
        structureTitle: spec.title ?? spec.key.replace(/-/g, " "),
        structureOrdering: spec.order ?? index,
        pageNumber: spec.page ?? Math.floor(index / 2) + 1,
        lineStart: index * 10 + 1,
        lineEnd: index * 10 + 8,
        documentId,
        versionId: BigInt(version),
    };
}

function buildScenario(spec: ScenarioSpec, ordinal: number): MaterialityEvaluationScenario {
    const previousChunks = spec.previous.map((value, index) => chunk(ordinal, 1, index, value));
    const currentChunks = spec.current.map((value, index) => chunk(ordinal, 2, index, value));
    const previousIds = new Map(spec.previous.map((value, index) => [value.key, previousChunks[index]!.chunkId]));
    const currentIds = new Map(spec.current.map((value, index) => [value.key, currentChunks[index]!.chunkId]));
    const ids = (keys: readonly string[], values: Map<string, number>) => keys.map(key => {
        const id = values.get(key);
        if (id === undefined) throw new Error(`Unknown fixture chunk key ${key} in ${spec.id}.`);
        return id;
    });
    const changes = (spec.changes ?? []).map(change => ({
        id: `${spec.id}:${change.id}`,
        material: change.material,
        category: change.category,
        previousChunkIds: ids(change.previousKeys, previousIds),
        currentChunkIds: ids(change.currentKeys, currentIds),
    }));
    return {
        id: spec.id,
        description: spec.description,
        documentKind: spec.documentKind,
        multiChunk: previousChunks.length > 1 || currentChunks.length > 1,
        largeDocument: spec.largeDocument ?? false,
        previousChunks,
        currentChunks,
        expected: {
            meaningfulChanges: changes.filter(change => change.material),
            nonMaterialChanges: changes.filter(change => !change.material),
            expectedNoOps: (spec.noOps ?? []).map(noOp => ({
                id: `${spec.id}:${noOp.id}`,
                previousChunkId: ids([noOp.previousKey], previousIds)[0]!,
                currentChunkId: ids([noOp.currentKey], currentIds)[0]!,
            })),
            expectedAlignmentRelations: spec.relations.map(relation => ({
                id: `${spec.id}:${relation.id}`,
                relation: relation.relation,
                previousChunkIds: ids(relation.previousKeys, previousIds),
                currentChunkIds: ids(relation.currentKeys, currentIds),
            })),
        },
    };
}

function single(
    id: string,
    documentKind: string,
    before: string,
    after: string,
    expectation: { material: boolean; category: DocumentChangeCategory | null } | "noop",
    description: string
): ScenarioSpec {
    return {
        id,
        description,
        documentKind,
        previous: [{ key: "main", content: before, path: "/main", title: "Main" }],
        current: [{ key: "main", content: after, path: "/main", title: "Main" }],
        ...(expectation === "noop"
            ? { noOps: [{ id: "noop", previousKey: "main", currentKey: "main" }] }
            : { changes: [{ id: "change", ...expectation, previousKeys: ["main"], currentKeys: ["main"] }] }),
        relations: [{ id: "alignment", relation: "modified", previousKeys: ["main"], currentKeys: ["main"] }],
    };
}

const SIMPLE_SCENARIOS: readonly ScenarioSpec[] = [
    single("noop-whitespace", "operating plan", "Platform owns telemetry.", "  Platform   owns telemetry.  ", "noop", "Repeated and boundary whitespace in an operating plan."),
    single("noop-line-wrap", "launch plan", "The enterprise launch remains on schedule.", "The enterprise launch\r\nremains on schedule.", "noop", "Extraction line wrapping in a launch plan."),
    single("noop-nbsp", "pricing plan", "Enterprise price review", "Enterprise\u00a0price review", "noop", "A non-breaking-space extraction difference."),
    single("noop-unicode", "founder operating notes", "The caf\u00e9 review is complete.", "The cafe\u0301 review is complete.", "noop", "Unicode NFC-equivalent founder notes."),
    single("noop-format-artifact", "product roadmap", "Roadmap assumptions remain unchanged.", "**Roadmap assumptions remain unchanged.**", { material: false, category: null }, "A Markdown emphasis extraction artifact that current no-op normalization does not remove."),

    single("paraphrase-ownership", "ownership document", "Product owns telemetry.", "Telemetry is owned by Product.", { material: false, category: null }, "A pure ownership paraphrase with the same DRI."),
    single("paraphrase-quarter", "launch plan", "The launch remains planned for Q3.", "We still expect the launch during the third quarter.", { material: false, category: null }, "A deadline paraphrase with unchanged timing."),
    single("paraphrase-customer", "sales strategy", "We will begin with design partners before broad availability.", "Broad availability will follow the initial design-partner cohort.", { material: false, category: null }, "A rollout paraphrase with unchanged business meaning."),

    single("ownership-team", "technical rollout plan", "Product owns retry telemetry.", "Platform owns retry telemetry.", { material: true, category: "ownership_change" }, "Ownership transfers from Product to Platform."),
    single("ownership-person", "operating plan", "Owner: Alice", "Owner: Bob", { material: true, category: "ownership_change" }, "The named operating-plan owner changes."),
    single("ownership-function", "sales strategy", "Marketing owns partner enablement.", "Sales owns partner enablement.", { material: true, category: "ownership_change" }, "Partner enablement ownership transfers functions."),

    single("status-launched", "product roadmap", "The migration is planned.", "The migration is launched.", { material: true, category: "status_change" }, "A roadmap item progresses from planned to launched."),
    single("status-blocked", "technical rollout plan", "The rollout is in progress.", "The rollout is blocked.", { material: true, category: "status_change" }, "An in-progress rollout becomes blocked."),
    single("status-resolved", "risk register", "The integration is blocked.", "The integration is resolved.", { material: true, category: "risk_or_blocker_change" }, "A documented blocker is resolved."),
    single("status-cancelled", "launch plan", "The beta is active.", "The beta is cancelled.", { material: true, category: "status_change" }, "An active beta is cancelled."),

    single("deadline-quarter", "product roadmap", "Launch target: Q3", "Launch target: Q4", { material: true, category: "deadline_change" }, "The launch target moves one quarter."),
    single("deadline-date", "customer commitment", "Customer go-live is June 1.", "Customer go-live is July 15.", { material: true, category: "deadline_change" }, "An enterprise customer go-live date moves."),
    single("deadline-year", "operating plan", "International expansion is targeted for 2026.", "International expansion is targeted for 2027.", { material: true, category: "deadline_change" }, "Expansion moves to the following year."),

    single("metric-percent", "pricing plan", "Expected conversion is 10%.", "Expected conversion is 25%.", { material: true, category: "metric_change" }, "The expected conversion metric changes."),
    single("metric-currency", "operating plan", "ARR target is $1M.", "ARR target is $750k.", { material: true, category: "metric_change" }, "The annual recurring revenue target declines."),
    single("metric-customers", "sales strategy", "The cohort includes 20 customers.", "The cohort includes 50 customers.", { material: true, category: "metric_change" }, "The customer cohort expands."),

    single("requirement-may-must", "enterprise onboarding", "Admins may enable SSO.", "Admins must enable SSO.", { material: true, category: "requirement_change" }, "An onboarding capability becomes mandatory."),
    single("requirement-optional", "technical rollout plan", "Audit logging is optional.", "Audit logging is required.", { material: true, category: "requirement_change" }, "Audit logging changes from optional to required."),
    single("requirement-should", "customer commitment", "Support should acknowledge P0 cases.", "Support must acknowledge P0 cases.", { material: true, category: "requirement_change" }, "A support recommendation becomes an obligation."),
    single("requirement-mandatory", "operating plan", "Security review is recommended.", "Security review is mandatory.", { material: true, category: "requirement_change" }, "A security review becomes mandatory."),

    single("negation-support", "enterprise onboarding", "The plan supports SSO.", "The plan does not support SSO.", { material: true, category: "requirement_change" }, "SSO support is explicitly negated."),
    single("negation-availability", "pricing plan", "The add-on is available.", "The add-on is unavailable.", { material: true, category: "requirement_change" }, "An add-on becomes unavailable."),

    single("risk-added", "risk register", "No delivery concern is recorded.", "Delivery risk is recorded for the data migration.", { material: true, category: "risk_or_blocker_change" }, "A delivery risk is introduced."),
    single("risk-removed", "risk register", "Vendor risk remains open.", "The vendor concern has been cleared.", { material: true, category: "risk_or_blocker_change" }, "A risk is removed using non-lexical resolution language."),
    single("blocker-introduced", "technical rollout plan", "Identity testing is in progress.", "Identity testing has a blocker.", { material: true, category: "status_change" }, "A blocker interrupts work that was in progress; status precedence is expected."),
    single("blocker-resolved", "founder operating notes", "Billing migration is blocked.", "Billing migration is unblocked.", { material: true, category: "risk_or_blocker_change" }, "A billing blocker is cleared."),

    single("scope-global", "launch plan", "Availability: US only", "Availability: global", { material: true, category: "scope_change" }, "Launch geography expands globally."),
    single("scope-enterprise", "sales strategy", "Access is for pilot customers.", "Access is for all enterprise customers.", { material: true, category: "scope_change" }, "A pilot expands to all enterprise customers."),
    single("priority-p0", "product roadmap", "Migration priority: P2", "Migration priority: P0", { material: true, category: "priority_change" }, "A roadmap item is escalated to P0."),
    single("priority-immediate", "founder operating notes", "The pricing review is deferred.", "The pricing review is immediate.", { material: true, category: "priority_change" }, "A deferred pricing review becomes immediate."),
];

function sectionChunks(prefix: string, contents: readonly string[], path: string, pageStart = 1): ChunkSpec[] {
    return contents.map((content, index) => ({
        key: `${prefix}-${index + 1}`,
        content,
        path,
        title: prefix.replace(/-/g, " "),
        order: index,
        page: pageStart + index,
    }));
}

const MULTI_SCENARIOS: readonly ScenarioSpec[] = [
    {
        id: "rewrite-roadmap-same-meaning",
        description: "A six-fragment roadmap section is reorganized without changing ownership, timing, or scope.",
        documentKind: "product roadmap",
        previous: sectionChunks("roadmap", [
            "The team will validate demand with design partners.", "Product continues to own the launch checklist.",
            "General availability remains targeted for the third quarter.", "The initial cohort remains limited to enterprise design partners.",
            "Security review continues before activation.", "No change is made to the rollout decision gate.",
        ], "/roadmap"),
        current: sectionChunks("roadmap", [
            "Demand validation will continue through conversations with design partners.", "The launch checklist remains under Product ownership.",
            "The third quarter remains the target for general availability.", "Enterprise design partners still make up the initial cohort.",
            "Activation continues to follow the security review.", "The rollout decision gate remains as previously documented.",
        ], "/roadmap"),
        changes: [{ id: "rewrite", material: false, category: null, previousKeys: ["roadmap-1", "roadmap-2", "roadmap-3", "roadmap-4", "roadmap-5", "roadmap-6"], currentKeys: ["roadmap-1", "roadmap-2", "roadmap-3", "roadmap-4", "roadmap-5", "roadmap-6"] }],
        relations: [1, 2, 3, 4, 5, 6].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`roadmap-${index}`], currentKeys: [`roadmap-${index}`] })),
        largeDocument: true,
    },
    {
        id: "rewrite-onboarding-same-meaning",
        description: "An enterprise onboarding section is rewritten in a more narrative style with unchanged controls.",
        documentKind: "enterprise onboarding document",
        previous: sectionChunks("onboarding", ["Customer success coordinates kickoff.", "Security receives the questionnaire before configuration.", "The customer validates SSO in staging.", "Production access follows customer sign-off.", "Support monitors the first business day."], "/onboarding"),
        current: sectionChunks("onboarding", ["Kickoff coordination remains with customer success.", "The questionnaire continues to reach security ahead of configuration.", "SSO validation still occurs in the staging environment.", "Customer sign-off continues to precede production access.", "The first business day remains under support monitoring."], "/onboarding"),
        changes: [{ id: "rewrite", material: false, category: null, previousKeys: ["onboarding-1", "onboarding-2", "onboarding-3", "onboarding-4", "onboarding-5"], currentKeys: ["onboarding-1", "onboarding-2", "onboarding-3", "onboarding-4", "onboarding-5"] }],
        relations: [1, 2, 3, 4, 5].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`onboarding-${index}`], currentKeys: [`onboarding-${index}`] })),
        largeDocument: true,
    },
    {
        id: "rewrite-pricing-same-meaning",
        description: "A pricing narrative changes voice and ordering while retaining the same approval and rollout policy.",
        documentKind: "pricing plan",
        previous: sectionChunks("pricing", ["Finance reviews discount exceptions.", "Sales submits the business rationale.", "Legal reviews non-standard terms.", "The pricing council makes the final decision.", "Approved changes enter the next catalog release."], "/pricing"),
        current: sectionChunks("pricing", ["Discount exceptions continue to receive finance review.", "The business rationale still comes from sales.", "Non-standard terms continue through legal review.", "Final decisions remain with the pricing council.", "The next catalog release continues to carry approved changes."], "/pricing"),
        changes: [{ id: "rewrite", material: false, category: null, previousKeys: ["pricing-1", "pricing-2", "pricing-3", "pricing-4", "pricing-5"], currentKeys: ["pricing-1", "pricing-2", "pricing-3", "pricing-4", "pricing-5"] }],
        relations: [1, 2, 3, 4, 5].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`pricing-${index}`], currentKeys: [`pricing-${index}`] })),
        largeDocument: true,
    },
    {
        id: "rewrite-rollout-material",
        description: "A six-fragment technical rollout rewrite transfers ownership, advances status, and expands scope.",
        documentKind: "technical rollout plan",
        previous: sectionChunks("rollout", ["Product owns deployment telemetry.", "The rollout is planned.", "Availability is US only.", "Audit logging is optional.", "Identity integration risk remains open.", "The pilot includes 20 customers."], "/rollout"),
        current: sectionChunks("rollout", ["Platform owns deployment telemetry.", "The rollout is launched.", "Availability is global.", "Audit logging is required.", "Identity integration risk is resolved.", "The launch includes 50 customers."], "/rollout"),
        changes: [{ id: "rewrite", material: true, category: "ownership_change", previousKeys: ["rollout-1", "rollout-2", "rollout-3", "rollout-4", "rollout-5", "rollout-6"], currentKeys: ["rollout-1", "rollout-2", "rollout-3", "rollout-4", "rollout-5", "rollout-6"] }],
        relations: [1, 2, 3, 4, 5, 6].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`rollout-${index}`], currentKeys: [`rollout-${index}`] })),
        largeDocument: true,
    },
    {
        id: "rewrite-customer-commitment-material",
        description: "A customer commitment section changes its deadline and makes implementation support mandatory.",
        documentKind: "customer commitment",
        previous: sectionChunks("commitment", ["Customer go-live is June 1.", "Implementation support is recommended.", "The pilot covers US accounts.", "Product owns escalation review.", "The security risk remains open."], "/commitment"),
        current: sectionChunks("commitment", ["Customer go-live is July 15.", "Implementation support is mandatory.", "The pilot covers global accounts.", "Platform owns escalation review.", "The security risk is resolved."], "/commitment"),
        changes: [{ id: "rewrite", material: true, category: "ownership_change", previousKeys: ["commitment-1", "commitment-2", "commitment-3", "commitment-4", "commitment-5"], currentKeys: ["commitment-1", "commitment-2", "commitment-3", "commitment-4", "commitment-5"] }],
        relations: [1, 2, 3, 4, 5].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`commitment-${index}`], currentKeys: [`commitment-${index}`] })),
        largeDocument: true,
    },
    {
        id: "rewrite-risk-register-material",
        description: "A multi-page risk-register section records resolution of one blocker and introduction of another.",
        documentKind: "risk register",
        previous: sectionChunks("risks", ["Identity migration is blocked.", "Billing reconciliation has no recorded risk.", "The rollout is in progress.", "The response owner is Product.", "The review target is Q3."], "/risks"),
        current: sectionChunks("risks", ["Identity migration is resolved.", "Billing reconciliation has a blocker.", "The rollout is paused.", "The response owner is Platform.", "The review target is Q4."], "/risks"),
        changes: [{ id: "rewrite", material: true, category: "ownership_change", previousKeys: ["risks-1", "risks-2", "risks-3", "risks-4", "risks-5"], currentKeys: ["risks-1", "risks-2", "risks-3", "risks-4", "risks-5"] }],
        relations: [1, 2, 3, 4, 5].map(index => ({ id: `pair-${index}`, relation: "modified" as const, previousKeys: [`risks-${index}`], currentKeys: [`risks-${index}`] })),
        largeDocument: true,
    },
    {
        id: "alignment-section-moved",
        description: "An unchanged founder-notes section moves from the opening to the end of the document.",
        documentKind: "founder operating notes",
        previous: [{ key: "moved", content: "The operating cadence remains weekly with a Friday review.", path: "/opening", title: "Cadence", order: 0, page: 1 }, { key: "stable", content: "The hiring plan remains unchanged.", path: "/hiring", title: "Hiring", order: 1, page: 2 }],
        current: [{ key: "stable", content: "The hiring plan remains unchanged.", path: "/hiring", title: "Hiring", order: 0, page: 1 }, { key: "moved", content: "The operating cadence remains weekly with a Friday review.", path: "/closing", title: "Operating rhythm", order: 1, page: 6 }],
        relations: [{ id: "moved", relation: "unchanged", previousKeys: ["moved"], currentKeys: ["moved"] }, { id: "stable", relation: "unchanged", previousKeys: ["stable"], currentKeys: ["stable"] }],
    },
    {
        id: "alignment-renamed-heavy-rewrite",
        description: "A renamed sales-strategy section preserves intent through a heavy lexical rewrite.",
        documentKind: "sales strategy",
        previous: [{ key: "strategy", content: "Regional account executives qualify expansion opportunities during quarterly portfolio reviews.", path: "/commercial-motion", title: "Commercial motion", order: 2, page: 4 }],
        current: [{ key: "strategy", content: "Every quarter, territory sellers examine existing customers to identify places where adoption can broaden.", path: "/growth-playbook", title: "Growth playbook", order: 7, page: 12 }],
        changes: [{ id: "rewrite", material: false, category: null, previousKeys: ["strategy"], currentKeys: ["strategy"] }],
        relations: [{ id: "rewrite", relation: "modified", previousKeys: ["strategy"], currentKeys: ["strategy"] }],
    },
    {
        id: "alignment-one-to-many",
        description: "One enterprise-onboarding paragraph is split into two structurally adjacent paragraphs.",
        documentKind: "enterprise onboarding document",
        previous: [{ key: "combined", content: "Security reviews the questionnaire and customer success schedules kickoff after approval.", path: "/onboarding", title: "Onboarding", order: 1, page: 3 }],
        current: [{ key: "security", content: "Security reviews the questionnaire before approval.", path: "/onboarding", title: "Onboarding", order: 1, page: 3 }, { key: "kickoff", content: "Customer success schedules kickoff after approval.", path: "/onboarding", title: "Onboarding", order: 2, page: 3 }],
        changes: [{ id: "split", material: false, category: null, previousKeys: ["combined"], currentKeys: ["security", "kickoff"] }],
        relations: [{ id: "split", relation: "split", previousKeys: ["combined"], currentKeys: ["security", "kickoff"] }],
    },
    {
        id: "alignment-many-to-one",
        description: "Two adjacent pricing-control fragments merge into one paragraph without changing policy.",
        documentKind: "pricing plan",
        previous: [{ key: "finance", content: "Finance reviews discount exceptions.", path: "/controls", title: "Controls", order: 1, page: 2 }, { key: "council", content: "The pricing council makes the final decision.", path: "/controls", title: "Controls", order: 2, page: 2 }],
        current: [{ key: "combined", content: "Finance reviews discount exceptions before the pricing council makes the final decision.", path: "/controls", title: "Controls", order: 1, page: 2 }],
        changes: [{ id: "merge", material: false, category: null, previousKeys: ["finance", "council"], currentKeys: ["combined"] }],
        relations: [{ id: "merge", relation: "merge", previousKeys: ["finance", "council"], currentKeys: ["combined"] }],
    },
    {
        id: "alignment-repeated-headings",
        description: "Repeated boilerplate headings surround one changed customer-commitment clause.",
        documentKind: "customer commitment",
        previous: [{ key: "north", content: "Implementation plan: Customer success coordinates the North account kickoff.", path: "/north/plan", title: "Implementation plan", order: 1 }, { key: "south", content: "Implementation plan: Customer success coordinates the South account kickoff.", path: "/south/plan", title: "Implementation plan", order: 2 }],
        current: [{ key: "south", content: "Implementation plan: Customer success coordinates the South account kickoff.", path: "/south/plan", title: "Implementation plan", order: 1 }, { key: "north", content: "Implementation plan: Platform coordinates the North account kickoff.", path: "/north/plan", title: "Implementation plan", order: 2 }],
        changes: [{ id: "north-owner", material: true, category: "ownership_change", previousKeys: ["north"], currentKeys: ["north"] }],
        relations: [{ id: "north", relation: "modified", previousKeys: ["north"], currentKeys: ["north"] }, { id: "south", relation: "unchanged", previousKeys: ["south"], currentKeys: ["south"] }],
    },
];

export const MATERIALITY_EVALUATION_FIXTURE_VERSION = "founder-weekly-review-materiality-evaluation/v1" as const;

export const MATERIALITY_EVALUATION_SCENARIOS: readonly MaterialityEvaluationScenario[] = [
    ...SIMPLE_SCENARIOS,
    ...MULTI_SCENARIOS,
].map(buildScenario);
