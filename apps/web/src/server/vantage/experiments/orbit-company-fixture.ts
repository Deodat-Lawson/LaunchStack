/** Pure fictional company data for an explicitly opted-in local demo. No I/O or approval workflow. */
import type {
    LabeledFact,
    MetadataFact,
    SourceFacts,
} from "@launchstack/tools/company-context/schema";

const definitions = [
    ["company.name", "Name", "Synthetic Orbit"],
    [
        "company.description",
        "Mission and business model",
        "Mission: safer pilot onboarding. Subscription SaaS for B2B teams; this profile does not approve a pilot.",
    ],
    ["company.industry", "Industry", "B2B SaaS / onboarding assurance."],
    [
        "markets.primary.0",
        "Target customers",
        "Small SaaS operators onboarding business customers.",
    ],
    ["services.0.name", "Product", "Orbit Pilot"],
    [
        "services.0.description",
        "Product scope",
        "An evidence workspace for onboarding and deletion checks.",
    ],
    ["projects.0.name", "Project", "Deletion assurance pilot"],
    [
        "projects.0.status",
        "Project status",
        "Active assurance workstream; delivery outcome/date unknown.",
    ],
    [
        "profile.facts.responsibilities",
        "Teams and responsibilities",
        "Engineering builds/tests deletion; Operations reconciles account samples; Privacy reviews acceptance evidence. Named staff are unknown.",
    ],
    [
        "profile.facts.priorities",
        "Priorities",
        "Reconcile run-17 samples before proposing access; validate deletion evidence before scaling.",
    ],
    [
        "profile.facts.decision_authority",
        "Decision authority",
        "Privacy may record Go, No-Go or Needs More Evidence; Engineering and Operations supply evidence but cannot authorise pilot access. No person or actual decision is recorded.",
    ],
    [
        "profile.facts.dependencies",
        "Process and dependencies",
        "Process: Engineering results -> Operations comparison -> Privacy decision. Shared account IDs and reviewer assignment are dependencies; delivery outcome/date are unknown.",
    ],
    [
        "policies.privacy_review",
        "Privacy constraints",
        "Minimise personal data; require separate privacy approval before pilot access. Test passes and document edits are not approval.",
    ],
] as const;

export const ORBIT_COMPANY_SOURCE_DOCUMENT = Object.freeze({
    title: "Synthetic Orbit fictional company reference",
    text: [
        "FICTIONAL COMPANY FIXTURE. These statements describe an invented organisation for a synthetic demonstration; they are not human approval or verified operational results.",
        ...definitions.map(([, label, value]) => `${label}: ${value}`),
        "Unknown: named staff, reporting hierarchy, delivery outcome/date, assigned privacy reviewer and any actual pilot approval.",
    ].join("\n"),
});

export interface OrbitCompanyFixtureInput {
    companyId: string;
    documentId: string;
    versionId: string;
    now: Date;
    asOf: string;
    /** None retains exact native version provenance, without pretending a quote was captured. */
    quoteMode?: "exact" | "none";
}
function nativeId(value: string): number {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error("A positive exact native identity is required.");
    return Number(value);
}

export function buildOrbitCompanyFixture(input: OrbitCompanyFixtureInput) {
    nativeId(input.companyId);
    const documentId = nativeId(input.documentId),
        versionId = nativeId(input.versionId);
    const at = input.now.toISOString(),
        cutoff = Date.parse(input.asOf);
    if (!Number.isFinite(cutoff) || input.now.getTime() > cutoff)
        throw new Error("The actual fixture timestamp must be no later than the reporting cutoff.");
    const mode = input.quoteMode ?? "none";
    const fact = (value: string): MetadataFact => ({
        value,
        visibility: "internal",
        usage: "no_outreach",
        confidence: 0.95,
        priority: "normal",
        status: "active",
        last_updated: at,
        sources: [
            {
                doc_id: documentId,
                version_id: versionId,
                doc_name: ORBIT_COMPANY_SOURCE_DOCUMENT.title,
                extracted_at: at,
                ...(mode === "exact" ? { quote: value } : {}),
            },
        ],
    });
    const values = new Map(definitions.map(([path, , value]) => [path, value]));
    const get = (path: (typeof definitions)[number][0]) => fact(values.get(path)!);
    const labeled = (
        path:
            | "profile.facts.responsibilities"
            | "profile.facts.priorities"
            | "profile.facts.decision_authority"
            | "profile.facts.dependencies"
    ): LabeledFact => ({ ...get(path), label: definitions.find(([key]) => key === path)![1] });
    const sourceFacts: SourceFacts = {
        company: {
            name: get("company.name"),
            description: get("company.description"),
            industry: get("company.industry"),
        },
        markets: { primary: [get("markets.primary.0")] },
        services: [{ name: get("services.0.name"), description: get("services.0.description") }],
        projects: [{ name: get("projects.0.name"), status: get("projects.0.status") }],
        profile: {
            facts: {
                responsibilities: labeled("profile.facts.responsibilities"),
                priorities: labeled("profile.facts.priorities"),
                decision_authority: labeled("profile.facts.decision_authority"),
                dependencies: labeled("profile.facts.dependencies"),
            },
        },
        policies: { privacy_review: get("policies.privacy_review") },
    };
    const record = {
        kind: "fictional-company-review-fixture/v1" as const,
        fixtureOnly: true as const,
        createdAt: at,
        fictionalReviewer: "Synthetic Orbit review exercise (fictional; no authenticated reviewer)",
        boundSources: [{ documentId: input.documentId, versionId: input.versionId }],
        reviewedFieldPaths: definitions.map(([path]) => path),
        acknowledgedUnknowns: [
            "Named staff",
            "Reporting hierarchy",
            "Project delivery outcome/date",
            "Assigned privacy reviewer",
            "Actual pilot approval",
        ],
        canonicalReviewState: "unreviewed" as const,
        authority:
            "Fictional review exercise only. No real human review, signature, approval or completion is asserted.",
    };
    return {
        sourceDocument: ORBIT_COMPANY_SOURCE_DOCUMENT,
        sourceFacts,
        provenanceMode:
            mode === "exact"
                ? ("exact-native-version-and-verbatim-quotes" as const)
                : ("exact-native-version-without-quote" as const),
        fieldMap: {
            mission: "company.description",
            businessModel: "company.description",
            industry: "company.industry",
            customers: "markets.primary.0",
            products: "services.0.name + services.0.description",
            projects: "projects.0.name + projects.0.status",
            teams: "profile.facts.responsibilities",
            responsibilities: "profile.facts.responsibilities",
            priorities: "profile.facts.priorities",
            processes: "profile.facts.dependencies",
            dependencies: "profile.facts.dependencies",
            privacy: "policies.privacy_review",
            authority: "profile.facts.decision_authority",
        },
        fictionalReviewDocument: {
            title: "FICTIONAL review fixture — Synthetic Orbit",
            text: `FICTIONAL HUMAN-REVIEW FIXTURE — NOT REAL APPROVAL\n${JSON.stringify(record, null, 2)}`,
            record,
        },
    };
}
