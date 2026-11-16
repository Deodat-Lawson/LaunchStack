import type {
    WeeklyReviewContextDto,
    WeeklyReviewDto,
    WeeklyReviewEvent,
    WeeklyReviewRoleDto,
    WeeklyReviewSourceInspectionDto,
    WeeklyReviewEvidenceDto,
} from "~/server/vantage/weekly-review-client-types";

const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
    });
const fail = (error: string, status = 409) => json({ error }, status);
const documents = [
    {
        id: "101",
        title: "Harborlight company architecture",
        category: "Company",
        text: "Harborlight is a fictional B2B invoice workflow startup. Maya owns customer discovery; Ravi owns engineering. Focus on activation before expanding acquisition.",
        hash: "24db65b1c36a0439856b8268d4591b5297ff4666a3c551ea207c9f3594ec206a",
    },
    {
        id: "102",
        title: "Activation funnel — weekly operating notes",
        category: "Operations",
        text: "162 teams signed up; 38 sent a first invoice. Of the 38 stalled teams reviewed, 24 stopped at bank connection. Maya proposes five discovery calls before expanding paid acquisition.",
        hash: "c29a772a462b1e2d1d9c6e6ba8747111a2790f8adac94e6b51ae049137f23085",
    },
    {
        id: "103",
        title: "Acme pilot rollout — customer call",
        category: "Customers",
        text: "Acme needs SAML SSO for a 140-seat rollout. Ravi proposes comparing two SSO vendors before promising a delivery date. No purchase or engineering commitment has been approved.",
        hash: "421be46b4182dccb4550387c1fb19bfb90469a51a7146cd32484e5c2f15fb4c1",
    },
    {
        id: "104",
        title: "Founder deck — signup measurement",
        category: "Finance",
        text: "The deck claims 40% weekly growth. Stripe export records 162 signups and PostHog records 149 for the same period. Maya proposes reconciling definitions before the investor update.",
        hash: "e83c326148a1596f699aa7b4608c23fd17586fd8034e6eb29cc87ebcce03f4ce",
    },
];
let counter = 0;
let context: WeeklyReviewContextDto;
let role: WeeklyReviewRoleDto;
let runs: WeeklyReviewDto[];
let activeIds: Map<string, string>;
let retries: Map<string, { body: string; value: unknown }>;
export function resetWeeklyReviewFixture() {
    context = {
        enabled: true,
        scopedEvidenceEnabled: true,
        canConfigure: true,
        documents: documents.map(({ id, title, category }) => ({ id, title, category })),
        policy: {
            architecture_document_id: "101",
            required_document_ids: ["102", "103"],
            required_source_scopes: {},
            version: 1,
            hasHiddenSources: false,
        },
        preferences: {
            star_document_ids: ["104"],
            star_source_scopes: {},
            version: 1,
            hasHiddenSources: false,
        },
    };
    role = { enabled: true, version: 0, canEdit: true, role: null };
    runs = [];
    activeIds = new Map();
    retries = new Map();
    counter = 0;
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const initial = writeReview(date.toISOString().slice(0, 10));
    runs.push(initial);
    activeIds.set(initial.evidence.inputSnapshot!.week, initial.id);
}
function sources() {
    const policy = context.policy!;
    return documents
        .filter(
            d =>
                d.id === policy.architecture_document_id ||
                policy.required_document_ids.includes(d.id) ||
                context.preferences!.star_document_ids.includes(d.id)
        )
        .map(d => ({
            ref: `doc:${d.id}@1`,
            version: "1",
            hash: d.hash,
            text: d.text,
            title: d.title,
            purpose:
                d.id === policy.architecture_document_id
                    ? "company-architecture"
                    : policy.required_document_ids.includes(d.id)
                      ? "workspace-required"
                      : "personal-star",
        }));
}
function writeReview(week: string, selected = sources()): WeeklyReviewDto {
    const id = `preview-review-${++counter}`;
    const topic = (
        index: number,
        title: string,
        question: string,
        call: string,
        next: string,
        owner: string
    ) => {
        const source = selected.find(s => s.ref === `doc:${102 + index}@1`) ?? selected[0]!;
        return {
            id: `${id}-topic-${index}`,
            title,
            decisionQuestion: question,
            facts: [{ text: source.text, refs: [source.ref] }],
            conflicts:
                index === 2
                    ? [
                          {
                              text: "Stripe and PostHog use different signup counts; the deck is not reconciled.",
                              refs: [source.ref],
                          },
                      ]
                    : [],
            whyItMatters:
                index === 0
                    ? "Acquisition can amplify onboarding friction before the team knows its cause."
                    : index === 1
                      ? "The pilot is valuable, but the team has limited engineering capacity."
                      : "Investors need a consistent definition of signup growth.",
            whyNow: "Review before the next weekly planning meeting.",
            rationale:
                "Fictional source evidence supports a bounded experiment, subject to founder approval.",
            recommendation: {
                call,
                confidence: "medium" as const,
                because: "Resolve the documented uncertainty before making a larger commitment.",
                refs: [source.ref],
                wouldChangeIf:
                    "New customer evidence or reconciled operating data changes the trade-off.",
            },
            proposedNextStep: next,
            proposedOwner: owner,
            proposedDue: null,
            helpRequested: null,
            unknowns: ["The result of the proposed follow-up is not known."],
        };
    };
    const result: WeeklyReviewDto = {
        schema: "vantage-weekly-review/v2.1",
        id,
        companyId: "1",
        ownerId: "preview-founder",
        version: 1,
        decisions: [],
        report: {
            schemaVersion: "vantage-weekly-review/v2.1",
            headline: "Validate the activation bottleneck before expanding",
            brief: "Three proposed decisions for Harborlight's founders.",
            summary:
                "Investigate activation friction, compare SSO options and reconcile signup reporting. These are proposals awaiting human decisions.",
            keyFigures: [
                {
                    label: "First invoices",
                    value: "38",
                    tone: "concern" as const,
                    refs: [selected.find(s => s.ref === "doc:102@1")?.ref ?? selected[0]!.ref],
                    derivation: null,
                },
            ].filter(() => selected.some(source => source.ref === "doc:102@1")),
            topics: [
                topic(
                    0,
                    "Activation before acquisition",
                    "Should paid acquisition wait for bank-connection discovery?",
                    "Propose five discovery calls before increasing paid spend",
                    "Interview five teams that stalled at bank connection",
                    "Maya"
                ),
                topic(
                    1,
                    "Acme's SSO rollout gate",
                    "Compare vendors or commit to building SAML now?",
                    "Propose comparing two SSO vendors before committing",
                    "Compare two vendors against an internal engineering estimate",
                    "Ravi"
                ),
                topic(
                    2,
                    "Reconcile signup growth",
                    "Which definition belongs in the investor update?",
                    "Propose reconciling Stripe and PostHog before updating the deck",
                    "Document one signup definition and reconcile the weekly exports",
                    "Maya"
                ),
            ].filter((_topic, index) =>
                selected.some(source => source.ref === `doc:${102 + index}@1`)
            ),
        },
        evidence: {
            qualityEvidence: "injected-deterministic",
            previewFixture: true,
            inputSnapshot: {
                candidateId: id,
                week,
                asOf: new Date().toISOString(),
                role: role.role?.primaryRole ?? "Founder",
                mandatoryCoverage: { required: selected.length, included: selected.length },
                sources: selected,
            },
        },
    };
    if (!result.report.topics.length)
        result.report.topics.push(
            topic(
                -1,
                "Confirm the company focus",
                "Does the current company focus still fit this week?",
                "Propose checking company priorities against new customer evidence",
                "Review current priorities before adding new work",
                "Maya"
            )
        );
    result.report.brief = `${result.report.topics.length} proposed decisions for Harborlight's founders.`;
    return result;
}
resetWeeklyReviewFixture();

const digest = async (text: string) =>
    Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
        byte => byte.toString(16).padStart(2, "0")
    ).join("");

async function applyScopes(candidate: WeeklyReviewDto) {
    const snapshot = candidate.evidence.inputSnapshot!;
    const proofs: NonNullable<typeof snapshot.scopedEvidence> = [];
    for (const source of [...snapshot.sources]) {
        const documentId = source.ref.split(":")[1]!.split("@")[0]!;
        const scope =
            source.purpose === "personal-star"
                ? context.preferences!.star_source_scopes[documentId]
                : context.policy!.required_source_scopes[documentId];
        if (!scope) continue;
        if (scope.version !== source.version || scope.expectedParentHash !== source.hash)
            throw Error("source_version_unavailable");
        const scopeHash = await digest(JSON.stringify(scope));
        const units = await Promise.all(
            scope.requiredUnits.map(async unit => {
                const text = source.text.slice(unit.start, unit.end);
                if (
                    unit.start < 0 ||
                    unit.start >= unit.end ||
                    unit.end > source.text.length ||
                    (await digest(text)) !== unit.excerptHash
                )
                    throw Error("invalid_source_scopes");
                return {
                    ...unit,
                    ref: `unit:${await digest(JSON.stringify([documentId, source.version, source.hash, scopeHash, unit.id]))}`,
                    anchors: [
                        { chunkId: documentId, ordinal: 0, start: unit.start, end: unit.end },
                    ],
                    text,
                };
            })
        );
        const coverage: (typeof proofs)[number]["coverage"] = {
            state:
                units.length === 1 && units[0]!.start === 0 && units[0]!.end === source.text.length
                    ? "full_document_reviewed"
                    : "relevant_spans_reviewed",
            qualification: scope.qualification,
            requiredUnits: units.length,
            includedUnits: units.length,
            reviewedRepresentation: "canonical_indexed_text" as const,
            originalCompleteness: "unknown" as const,
        };
        proofs.push({
            version: "vantage-scoped-evidence/v2",
            actorId: "preview-founder",
            companyId: "1",
            documentId,
            parentVersion: source.version,
            parentHash: source.hash,
            parentChars: source.text.length,
            scopeHash,
            authorityRevision: "preview",
            purpose: source.purpose as
                | "company-architecture"
                | "workspace-required"
                | "personal-star",
            audience: source.purpose === "personal-star" ? "actor" : "company",
            companyReadable: true,
            aclRevision: "preview",
            versionDate: "2026-11-16T10:00:00.000Z",
            availableAt: "2026-11-16T10:00:00.000Z",
            offsetEncoding: "utf16_half_open",
            requiredUnits: scope.requiredUnits,
            units: units.map(({ text: _text, ...unit }) => unit),
            coverage,
        });
        snapshot.sources = snapshot.sources.flatMap(item =>
            item !== source
                ? [item]
                : units.map(unit => ({
                      ...source,
                      ref: unit.ref,
                      text: unit.text,
                      hash: unit.excerptHash,
                  }))
        );
        const refs = units.map(unit => unit.ref);
        for (const topic of candidate.report.topics) {
            topic.facts = topic.facts.flatMap(fact =>
                fact.refs.includes(source.ref)
                    ? units.map(unit => ({ text: unit.text, refs: [unit.ref] }))
                    : [fact]
            );
            topic.conflicts = topic.conflicts.filter(fact => !fact.refs.includes(source.ref));
            if (topic.recommendation?.refs.includes(source.ref)) topic.recommendation.refs = refs;
        }
        candidate.report.keyFigures = candidate.report.keyFigures.filter(
            figure => !figure.refs.includes(source.ref)
        );
    }
    if (proofs.length) snapshot.scopedEvidence = proofs;
    snapshot.mandatoryCoverage = {
        required: snapshot.sources.length,
        included: snapshot.sources.length,
    };
}

/** A browser-only fictional adapter. Stages surround real local operations, never elapsed timers. */
export async function simulateWeeklyReview(
    url: URL,
    init: RequestInit | undefined,
    admin: boolean
): Promise<Response> {
    const path = url.pathname.slice("/api/vantage/reviews".length).split("/").filter(Boolean);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown>;
    try {
        body =
            typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
    } catch {
        return fail("invalid_request", 400);
    }
    const headers = new Headers(init?.headers);
    const key = headers.get("Idempotency-Key");
    const slot = `${method}:${url.pathname}:${key}`;
    const previous = key ? retries.get(slot) : undefined;
    const encoded = JSON.stringify(body);
    if (previous) {
        if (previous.body !== encoded) return fail("idempotency_conflict");
        if (
            method === "POST" &&
            !path.length &&
            headers.get("Accept")?.includes("application/x-ndjson")
        )
            return new Response(JSON.stringify({ type: "result", result: previous.value }) + "\n", {
                headers: { "Content-Type": "application/x-ndjson" },
            });
        return json(previous.value, method === "POST" && !path.length ? 201 : 200);
    }
    const remember = (value: unknown, status = 200) => {
        if (key) retries.set(slot, { body: encoded, value });
        return json(value, status);
    };
    if (path[0] === "context") {
        if (path[1] === "role") {
            if (method === "GET") return json(role);
            if (method !== "PATCH") return fail("invalid_request", 400);
            if (body.expectedVersion !== role.version) return fail("stale_context_preferences");
            if (
                body.role !== null &&
                (body.confirmed !== true ||
                    typeof body.primaryRole !== "string" ||
                    !body.primaryRole.trim() ||
                    !Array.isArray(body.responsibilities) ||
                    !Array.isArray(body.priorities))
            )
                return fail("invalid_request", 400);
            role.version++;
            role.role =
                body.role === null
                    ? null
                    : {
                          schemaVersion: "vantage-business-role/v1",
                          primaryRole: String(body.primaryRole),
                          responsibilities: body.responsibilities as string[],
                          priorities: body.priorities as string[],
                          confirmed: true,
                          confirmedBy: "preview-founder",
                          companyId: "1",
                          revision: role.version,
                      };
            return remember({ role: role.role, version: role.version });
        }
        if (path[1] === "source" && method === "GET") {
            const documentId = url.searchParams.get("documentId");
            const purpose = url.searchParams.get("purpose");
            if (purpose !== "personal-star" && !admin)
                return fail("review_configuration_denied", 403);
            const doc = documents.find(d => d.id === documentId);
            if (!doc) return fail("source_access_denied", 403);
            const configured =
                purpose === "company-architecture"
                    ? context.policy!.architecture_document_id === doc.id
                    : purpose === "workspace-required"
                      ? context.policy!.required_document_ids.includes(doc.id)
                      : purpose === "personal-star" &&
                        context.preferences!.star_document_ids.includes(doc.id);
            if (!configured) return fail("source_not_configured", 404);
            const config = purpose === "personal-star" ? context.preferences! : context.policy!;
            const scope =
                purpose === "personal-star"
                    ? context.preferences!.star_source_scopes[doc.id]
                    : context.policy!.required_source_scopes[doc.id];
            const version = url.searchParams.get("version");
            if (version && version !== "1") return fail("source_version_unavailable");
            const result: WeeklyReviewSourceInspectionDto = {
                document: { id: doc.id, title: doc.title },
                purpose: purpose as WeeklyReviewSourceInspectionDto["purpose"],
                configurationVersion: config.version,
                pin: scope
                    ? {
                          scope,
                          status:
                              scope.expectedParentHash === doc.hash ? "valid" : "content_changed",
                      }
                    : null,
                versions: [{ version: "1", createdAt: "2026-11-16T10:00:00.000Z" }],
                preview:
                    version || scope
                        ? {
                              version: "1",
                              parentHash: doc.hash,
                              text: doc.text,
                              chunks: [{ id: doc.id, ordinal: 0, start: 0, end: doc.text.length }],
                              originalCompleteness: "unknown",
                              offsetEncoding: "utf16_half_open",
                          }
                        : null,
            };
            return json(result);
        }
        if (!path[1] && method === "GET") return json({ ...context, canConfigure: admin });
        if (!path[1] && (method === "POST" || method === "PATCH")) {
            const personal = method === "PATCH";
            if (!personal && !admin) return fail("review_policy_forbidden", 403);
            const config = personal ? context.preferences! : context.policy!;
            if (body.expectedVersion !== config.version)
                return fail(personal ? "stale_context_preferences" : "stale_context_policy");
            const ids = body[personal ? "starDocumentIds" : "requiredDocumentIds"];
            if (
                !Array.isArray(ids) ||
                ids.some(id => !documents.some(d => d.id === id)) ||
                (personal && ids.length > 8)
            )
                return fail("invalid_request", 400);
            if (!personal && !documents.some(d => d.id === body.architectureDocumentId))
                return fail("required_context_incomplete");
            if (personal) {
                context.preferences!.star_document_ids = ids as string[];
                context.preferences!.star_source_scopes = (body.starSourceScopes ??
                    Object.fromEntries(
                        Object.entries(context.preferences!.star_source_scopes).filter(([id]) =>
                            ids.includes(id)
                        )
                    )) as NonNullable<typeof context.preferences>["star_source_scopes"];
            } else {
                context.policy!.architecture_document_id = String(body.architectureDocumentId);
                context.policy!.required_document_ids = ids as string[];
                context.policy!.required_source_scopes = (body.requiredSourceScopes ??
                    Object.fromEntries(
                        Object.entries(context.policy!.required_source_scopes).filter(
                            ([id]) => id === body.architectureDocumentId || ids.includes(id)
                        )
                    )) as NonNullable<typeof context.policy>["required_source_scopes"];
            }
            config.version++;
            return remember({ version: config.version });
        }
    }
    if (!path.length && method === "GET")
        return json({
            enabled: true,
            activeId: activeIds.get(url.searchParams.get("weekStart") ?? "") ?? null,
            runs: runs.map(r => ({
                id: r.id,
                week_start: r.evidence.inputSnapshot!.week,
                status: "accepted",
                review_version: r.version,
                created_at: r.evidence.inputSnapshot!.asOf,
            })),
        });
    if (!path.length && method === "POST") {
        if (typeof body.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart))
            return fail("invalid_request", 400);
        const parsedWeek = new Date(`${body.weekStart}T00:00:00.000Z`);
        if (
            !Number.isFinite(parsedWeek.getTime()) ||
            parsedWeek.toISOString().slice(0, 10) !== body.weekStart ||
            parsedWeek.getUTCDay() !== 1
        )
            return fail("invalid_review_week", 400);
        const generate = async (emit: (event: WeeklyReviewEvent) => void) => {
            emit({ type: "stage", stage: "gathering" });
            if (!context.policy?.architecture_document_id) {
                emit({ type: "error", error: "required_context_incomplete", status: 409 });
                return null;
            }
            if (body.expectedActiveId !== (activeIds.get(String(body.weekStart)) ?? null)) {
                emit({ type: "error", error: "active_review_changed", status: 409 });
                return null;
            }
            const selected = sources();
            emit({ type: "stage", stage: "writing" });
            const candidate = writeReview(String(body.weekStart), selected);
            try {
                await applyScopes(candidate);
            } catch (error) {
                emit({
                    type: "error",
                    error: error instanceof Error ? error.message : "invalid_source_scopes",
                    status: 409,
                });
                return null;
            }
            emit({ type: "stage", stage: "checking" });
            const refs = new Set(candidate.evidence.inputSnapshot!.sources.map(s => s.ref));
            if (
                candidate.report.topics.some(t =>
                    t.facts.some(f => f.refs.some(ref => !refs.has(ref)))
                )
            ) {
                emit({ type: "error", error: "candidate_not_admitted", status: 409 });
                return null;
            }
            emit({ type: "stage", stage: "saving" });
            if (body.expectedActiveId !== (activeIds.get(String(body.weekStart)) ?? null)) {
                emit({ type: "error", error: "active_review_changed", status: 409 });
                return null;
            }
            runs.unshift(candidate);
            activeIds.set(String(body.weekStart), candidate.id);
            if (key) retries.set(slot, { body: encoded, value: candidate });
            emit({ type: "result", result: candidate });
            return candidate;
        };
        if (headers.get("Accept")?.includes("application/x-ndjson"))
            return new Response(
                new ReadableStream({
                    async start(controller) {
                        const encoder = new TextEncoder();
                        await generate(event =>
                            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
                        );
                        controller.close();
                    },
                }),
                { headers: { "Content-Type": "application/x-ndjson" } }
            );
        let error: { error: string; status: number } | undefined;
        const result = await generate(event => {
            if (event.type === "error") error = event;
        });
        return result ? json(result, 201) : fail(error!.error, error!.status);
    }
    const run = runs.find(r => r.id === path[0]);
    if (!run) return fail("review_not_found", 404);
    if (path.length === 1 && method === "GET") return json(run);
    if (path[1] === "evidence" && method === "GET") {
        const source = run.evidence.inputSnapshot?.sources.find(
            s => s.ref === url.searchParams.get("ref")
        );
        if (!source) return fail("evidence_not_found", 404);
        const proof = run.evidence.inputSnapshot?.scopedEvidence?.find(proof =>
            proof.units.some(unit => unit.ref === source.ref)
        );
        const unit = proof?.units.find(unit => unit.ref === source.ref);
        const result: WeeklyReviewEvidenceDto = {
            ...source,
            authorization: "current",
            originalCompleteness: "unknown",
            scope:
                proof && unit
                    ? {
                          documentId: proof.documentId,
                          parentVersion: proof.parentVersion,
                          parentHash: proof.parentHash,
                          scopeHash: proof.scopeHash,
                          start: unit.start,
                          end: unit.end,
                          anchors: unit.anchors,
                          coverage: proof.coverage,
                          offsetEncoding: proof.offsetEncoding,
                      }
                    : null,
        };
        return json(result);
    }
    if (path[1] === "decisions" && method === "POST") {
        if (body.expectedVersion !== run.version) return fail("stale_review");
        if (!run.report.topics.some(t => t.id === body.topicId))
            return fail("topic_not_found", 404);
        if (typeof body.decision !== "string" || !body.decision.trim())
            return fail("invalid_request", 400);
        run.version++;
        run.decisions.push({
            key: key ?? `preview-decision-${run.version}`,
            expectedVersion: Number(body.expectedVersion),
            topicId: String(body.topicId),
            decision: body.decision,
            ...(typeof body.outcome === "string" ? { outcome: body.outcome } : {}),
            actorId: "preview-founder",
            version: run.version,
            recordedAt: new Date().toISOString(),
        });
        return remember({ version: run.version });
    }
    return fail("review_not_found", 404);
}
