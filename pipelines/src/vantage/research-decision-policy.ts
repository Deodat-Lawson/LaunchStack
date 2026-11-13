import { createHash } from "node:crypto";
import { z } from "zod";

/** Unintegrated offline prototype. Every result is preparation data only. */
const id = z.string().min(1).max(120);
const gapSchema = z
    .object({
        id,
        kind: z.enum([
            "internal-definition",
            "internal-state",
            "missing-internal-evidence",
            "external-claim",
            "temporal-uncertainty",
        ]),
        decisionImpact: z.enum(["material", "minor"]),
        supportingSourceRefs: z.array(id).max(10),
        rationale: z.string().max(300),
    })
    .strict();
const proposalSchema = z.discriminatedUnion("mode", [
    z
        .object({
            mode: z.literal("STOP"),
            reason: z.enum(["sufficient", "no-useful-question", "budget-exhausted"]),
        })
        .strict(),
    z
        .object({
            mode: z.literal("INTERNAL_FOLLOW_UP"),
            gapIds: z.array(id).min(1).max(3),
            internalQuery: z.string().min(1).max(600),
        })
        .strict(),
    z
        .object({
            mode: z.literal("PUBLIC_RESEARCH"),
            gapIds: z.array(id).min(1).max(3),
            approvedProjectionId: id,
            publicEntityId: id,
            questionId: id,
        })
        .strict(),
    z
        .object({
            mode: z.literal("NEEDS_APPROVAL"),
            reason: z.enum(["disclosure", "spend", "provider", "policy"]),
        })
        .strict(),
]);
export const researchDecisionSchema = z
    .object({
        schemaVersion: z.literal("vantage-research-decision/v1"),
        inputFingerprint: id,
        evidenceGaps: z.array(gapSchema).max(3),
        proposed: proposalSchema,
    })
    .strict();

export type ResearchDecision = z.infer<typeof researchDecisionSchema>;
export type ProviderPin = Readonly<{
    providerId: string;
    endpoint: string;
    configurationVersion: string;
    recipient: string;
    purpose: string;
}>;
export type ResearchAuthority = Readonly<{
    companyId: string;
    actorId: string;
    inputFingerprint: string;
    reportingCutoff: string;
    sourceAuthorityEpoch: string;
    policyRevision: string;
}>;
/** Host-owned catalog, supplied independently of model output and source text. */
export type PublicProjection = Readonly<{
    projectionId: string;
    publicEntityId: string;
    publicName: string;
    officialDomain: string;
    questions: ReadonlyArray<
        Readonly<{ id: string; kind: "announcement" | "pricing" | "industry" }>
    >;
}>;
/** Fixture representation of a trusted host ledger record, never model-issued authority. */
export type ResearchPreparationGrant = Readonly<{
    authority: ResearchAuthority;
    provider: ProviderPin;
    requestFingerprint: string;
    expiresAt: string;
    authorizedExternalSpendMicros: number;
    reservation: Readonly<{
        id: string;
        state: "reserved" | "unknown-usage" | "settled" | "exhausted";
        requestFingerprint: string;
        reservedWorstCaseMicros: number;
        attemptsReserved: number;
    }>;
}>;
const authoritySchema = z
    .object({
        companyId: id,
        actorId: id,
        inputFingerprint: id,
        reportingCutoff: id,
        sourceAuthorityEpoch: id,
        policyRevision: id,
    })
    .strict();
const providerSchema = z
    .object({
        providerId: id,
        endpoint: z.string().url().max(2048),
        configurationVersion: id,
        recipient: id,
        purpose: id,
    })
    .strict();
const preparationGrantSchema = z
    .object({
        authority: authoritySchema,
        provider: providerSchema,
        requestFingerprint: id,
        expiresAt: id,
        authorizedExternalSpendMicros: z.number().int().nonnegative(),
        reservation: z
            .object({
                id,
                state: z.enum(["reserved", "unknown-usage", "settled", "exhausted"]),
                requestFingerprint: id,
                reservedWorstCaseMicros: z.number().int().nonnegative(),
                attemptsReserved: z.number().int().nonnegative(),
            })
            .strict(),
    })
    .strict();
export type ResearchPolicyInput = Readonly<{
    decision: unknown;
    authority: ResearchAuthority;
    authorizedSourceRefs: readonly string[];
    catalog: readonly PublicProjection[];
    provider?: ProviderPin;
    grant?: ResearchPreparationGrant;
    now: string;
    worstCaseRequestMicros: number;
    /** Zero unless the host explicitly authorizes fixture spending. */
    authorizedExternalSpendMicros?: number;
}>;
export type ResearchPreparation =
    | { mode: "STOP"; reason: string }
    | { mode: "INTERNAL_FOLLOW_UP"; internalQuery: string; gapIds: string[] }
    | { mode: "NEEDS_APPROVAL"; reason: string }
    | {
          mode: "PUBLIC_RESEARCH";
          preparationOnly: true;
          query: string;
          requestFingerprint: string;
          reservationId: string;
          provider: ProviderPin;
          limits: { searchCalls: 1; hits: 5; fetchedPages: 2; retries: 0 };
      };

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
/** ISO timestamps require seconds, an explicit offset and a real calendar date. */
function time(value: string): number {
    const match =
        /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
            value
        );
    if (!match) return NaN;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > days[month - 1]!) return NaN;
    return Date.parse(value);
}
function sameAuthority(left: ResearchAuthority, right: ResearchAuthority): boolean {
    return (
        left.companyId === right.companyId &&
        left.actorId === right.actorId &&
        left.inputFingerprint === right.inputFingerprint &&
        left.reportingCutoff === right.reportingCutoff &&
        left.sourceAuthorityEpoch === right.sourceAuthorityEpoch &&
        left.policyRevision === right.policyRevision
    );
}
function sameProvider(left: ProviderPin, right: ProviderPin): boolean {
    return (
        left.providerId === right.providerId &&
        left.endpoint === right.endpoint &&
        left.configurationVersion === right.configurationVersion &&
        left.recipient === right.recipient &&
        left.purpose === right.purpose
    );
}
function validProvider(provider: ProviderPin): boolean {
    try {
        const endpoint = new URL(provider.endpoint);
        return (
            endpoint.protocol === "https:" &&
            !endpoint.username &&
            !endpoint.password &&
            !!provider.providerId &&
            !!provider.configurationVersion &&
            !!provider.recipient &&
            !!provider.purpose
        );
    } catch {
        return false;
    }
}
/** Fixed host template. No private rationale, excerpt, title or model query is accepted. */
function publicQuery(projection: PublicProjection, questionId: string): string | undefined {
    const question = projection.questions.find(entry => entry.id === questionId);
    if (
        !question ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(projection.officialDomain) ||
        !/^[a-z0-9][a-z0-9 .&()-]{0,99}$/i.test(projection.publicName)
    )
        return undefined;
    return `site:${projection.officialDomain} ${projection.publicName} ${question.kind}`;
}
/** Deterministic binding for a host fixture reservation. This grants no dispatch capability. */
export function researchRequestFingerprint(
    authority: ResearchAuthority,
    provider: ProviderPin,
    projection: PublicProjection,
    questionId: string,
    worstCaseRequestMicros: number
): string | undefined {
    const query = publicQuery(projection, questionId);
    if (!query || !Number.isFinite(time(authority.reportingCutoff))) return undefined;
    return hash(
        JSON.stringify([
            authority.companyId,
            authority.actorId,
            authority.inputFingerprint,
            authority.reportingCutoff,
            authority.sourceAuthorityEpoch,
            authority.policyRevision,
            provider.providerId,
            provider.endpoint,
            provider.configurationVersion,
            provider.recipient,
            provider.purpose,
            projection.projectionId,
            projection.publicEntityId,
            questionId,
            query,
            worstCaseRequestMicros,
            1,
            5,
            2,
            0,
        ])
    );
}

/** Pure one-shot selection. No IO, dispatch, retries, provider discovery or autonomous loop. */
export function futureResearchDecision(input: ResearchPolicyInput): ResearchPreparation {
    const parsed = researchDecisionSchema.safeParse(input.decision);
    if (!parsed.success) return { mode: "NEEDS_APPROVAL", reason: "invalid-decision" };
    const decision = parsed.data;
    if (
        decision.inputFingerprint !== input.authority.inputFingerprint ||
        !Number.isFinite(time(input.authority.reportingCutoff)) ||
        !Number.isFinite(time(input.now))
    ) {
        return { mode: "NEEDS_APPROVAL", reason: "authority-mismatch" };
    }
    if (
        new Set(decision.evidenceGaps.map(gap => gap.id)).size !== decision.evidenceGaps.length ||
        decision.evidenceGaps.some(gap =>
            gap.supportingSourceRefs.some(ref => !input.authorizedSourceRefs.includes(ref))
        )
    ) {
        return { mode: "NEEDS_APPROVAL", reason: "invalid-evidence-reference" };
    }
    const proposal = decision.proposed;
    if (proposal.mode === "STOP" || proposal.mode === "NEEDS_APPROVAL") return proposal;
    const selectedGaps = decision.evidenceGaps.filter(gap => proposal.gapIds.includes(gap.id));
    if (selectedGaps.length !== proposal.gapIds.length)
        return { mode: "NEEDS_APPROVAL", reason: "invalid-gap-reference" };
    if (selectedGaps.every(gap => gap.decisionImpact === "minor"))
        return { mode: "STOP", reason: "no-useful-question" };
    if (proposal.mode === "INTERNAL_FOLLOW_UP") return proposal;
    if (
        selectedGaps.some(
            gap =>
                gap.kind === "internal-definition" ||
                gap.kind === "internal-state" ||
                gap.kind === "missing-internal-evidence"
        )
    ) {
        return { mode: "NEEDS_APPROVAL", reason: "internal-evidence-required" };
    }
    const projection = input.catalog.find(
        entry =>
            entry.projectionId === proposal.approvedProjectionId &&
            entry.publicEntityId === proposal.publicEntityId
    );
    const query = projection && publicQuery(projection, proposal.questionId);
    if (!projection || !query)
        return { mode: "NEEDS_APPROVAL", reason: "unapproved-public-projection" };
    const provider = input.provider;
    if (!provider || !validProvider(provider))
        return { mode: "NEEDS_APPROVAL", reason: "provider-unavailable" };
    if (!input.grant) return { mode: "NEEDS_APPROVAL", reason: "missing-grant" };
    const parsedGrant = preparationGrantSchema.safeParse(input.grant);
    if (!parsedGrant.success) return { mode: "NEEDS_APPROVAL", reason: "invalid-grant" };
    const grant = parsedGrant.data;
    const requestFingerprint = researchRequestFingerprint(
        input.authority,
        provider,
        projection,
        proposal.questionId,
        input.worstCaseRequestMicros
    )!;
    if (
        !sameAuthority(grant.authority, input.authority) ||
        !sameProvider(grant.provider, provider) ||
        grant.requestFingerprint !== requestFingerprint ||
        !Number.isFinite(time(grant.expiresAt)) ||
        time(grant.expiresAt) <= time(input.now)
    )
        return { mode: "NEEDS_APPROVAL", reason: "grant-mismatch" };
    const reservation = grant.reservation;
    if (
        !reservation ||
        reservation.state !== "reserved" ||
        !reservation.id ||
        reservation.requestFingerprint !== requestFingerprint ||
        reservation.attemptsReserved !== 1
    ) {
        return { mode: "NEEDS_APPROVAL", reason: "reservation-unavailable" };
    }
    const spend = input.authorizedExternalSpendMicros ?? 0;
    if (
        ![
            spend,
            input.worstCaseRequestMicros,
            grant.authorizedExternalSpendMicros,
            reservation.reservedWorstCaseMicros,
        ].every(Number.isSafeInteger) ||
        input.worstCaseRequestMicros <= 0 ||
        spend < input.worstCaseRequestMicros ||
        grant.authorizedExternalSpendMicros < input.worstCaseRequestMicros ||
        reservation.reservedWorstCaseMicros < input.worstCaseRequestMicros
    )
        return { mode: "STOP", reason: "budget-exhausted" };
    return {
        mode: "PUBLIC_RESEARCH",
        preparationOnly: true,
        query,
        requestFingerprint,
        reservationId: reservation.id,
        provider: { ...provider },
        limits: { searchCalls: 1, hits: 5, fetchedPages: 2, retries: 0 },
    };
}

export type PublicEvidence =
    | Readonly<{ kind: "snippet"; text: string; url: string }>
    | Readonly<{
          kind: "snapshot";
          snapshotId: string;
          requestedUrl: string;
          finalUrl: string;
          redirects: readonly string[];
          status: number;
          contentType: string;
          capturedAt: string;
          publishedAt?: string;
          body: string;
          bodyHash: string;
          providerId: string;
          requestId: string;
          queryHash: string;
          truncated: boolean;
      }>;
/** Strip adapter-only fields while cloning the declared capture representation. */
const snapshotSchema = z
    .object({
        kind: z.literal("snapshot"),
        snapshotId: id,
        requestedUrl: z.string().url(),
        finalUrl: z.string().url(),
        redirects: z.array(z.string().url()),
        status: z.literal(200),
        contentType: z.literal("text/html"),
        capturedAt: z.string().refine(value => Number.isFinite(time(value))),
        publishedAt: z
            .string()
            .refine(value => Number.isFinite(time(value)))
            .optional(),
        body: z.string().min(1),
        bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
        providerId: id,
        requestId: id,
        queryHash: id,
        truncated: z.literal(false),
    })
    .strip();
export type PublicEvidenceAdmission =
    | { status: "lead-only" | "rejected" | "later-supplement" | "stale"; reason: string }
    | {
          status: "admitted";
          attribution: "publisher-statement";
          companyPolicyAuthority: false;
          snapshot: Readonly<Extract<PublicEvidence, { kind: "snapshot" }>>;
      };
/** Offline provenance check. A production store must mint and persist immutable snapshot IDs. */
export function inspectPublicEvidence(
    evidence: PublicEvidence,
    policy: Readonly<{
        reportingCutoff: string;
        officialDomain: string;
        earliestCapture: string;
        approvedUrls: readonly string[];
        expectedProviderId: string;
        expectedRequestId: string;
        expectedQueryHash: string;
    }>
): PublicEvidenceAdmission {
    if (evidence.kind === "snippet") return { status: "lead-only", reason: "fetch-required" };
    const parsed = snapshotSchema.safeParse(evidence);
    if (!parsed.success) return { status: "rejected", reason: "invalid-snapshot" };
    const capture = parsed.data;
    const capturedAt = time(capture.capturedAt);
    const cutoff = time(policy.reportingCutoff);
    const earliest = time(policy.earliestCapture);
    if (
        ![capturedAt, cutoff, earliest].every(Number.isFinite) ||
        earliest > cutoff ||
        !capture.snapshotId ||
        !capture.providerId ||
        !capture.requestId ||
        !capture.queryHash ||
        capture.providerId !== policy.expectedProviderId ||
        capture.requestId !== policy.expectedRequestId ||
        capture.queryHash !== policy.expectedQueryHash ||
        capture.bodyHash !== hash(capture.body) ||
        !capture.body ||
        capture.truncated ||
        capture.status !== 200 ||
        capture.contentType !== "text/html"
    )
        return { status: "rejected", reason: "invalid-snapshot" };
    const urls = [capture.requestedUrl, ...capture.redirects, capture.finalUrl];
    const unsafe = urls.some(value => {
        try {
            const url = new URL(value);
            return (
                url.protocol !== "https:" ||
                url.hostname !== policy.officialDomain ||
                url.port !== "" ||
                !!url.username ||
                !!url.password ||
                !!url.search ||
                !!url.hash ||
                !policy.approvedUrls.includes(value)
            );
        } catch {
            return true;
        }
    });
    // Every requested URL and redirect requires an exact host-approved destination.
    if (unsafe) return { status: "rejected", reason: "unapproved-destination" };
    if (capturedAt > cutoff)
        return { status: "later-supplement", reason: "capture-after-reporting-cutoff" };
    if (capturedAt < earliest)
        return { status: "stale", reason: "capture-outside-authorized-window" };
    const snapshot = Object.freeze({
        ...capture,
        redirects: Object.freeze([...capture.redirects]),
    });
    return {
        status: "admitted",
        attribution: "publisher-statement",
        companyPolicyAuthority: false,
        snapshot,
    };
}
