/**
 * In-memory stand-in for `/api/distribution/*`, shaped exactly like the
 * routes' JSON. It implements enough of the rules (stage transitions with
 * required fields, exclusions on outreach, dashboard aggregates) for the UI
 * to behave as it will against the real backend.
 */
import type {
    AgreementDto,
    PartnerKind,
    DashboardDto,
    EventDto,
    EvidenceDto,
    OrgDto,
    PartnerItemDto,
    ProgramDto,
    RelationshipDto,
    RelationshipStage,
    RunDto,
} from "~/app/employer/tools/distribution/api";

const ORDER: RelationshipStage[] = [
    "candidate",
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
];
const ALLOWED: Record<RelationshipStage, RelationshipStage[]> = {
    candidate: ["researched", "contacted", "declined", "dormant"],
    researched: ["contacted", "candidate", "declined", "dormant"],
    contacted: ["in_conversation", "researched", "declined", "dormant"],
    in_conversation: ["qualified", "contacted", "declined", "dormant"],
    qualified: ["negotiating", "in_conversation", "declined", "dormant"],
    negotiating: ["contracted", "qualified", "declined", "dormant"],
    contracted: ["active", "negotiating", "dormant"],
    active: ["dormant", "negotiating"],
    declined: ["candidate", "researched"],
    dormant: ["candidate", "contacted", "in_conversation", "qualified", "active"],
};

interface Store {
    programs: ProgramDto[];
    runs: RunDto[];
    orgs: OrgDto[];
    relationships: RelationshipDto[];
    evidence: EvidenceDto[];
    events: EventDto[];
    agreements: AgreementDto[];
    nextId: number;
}

const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function seed(): Store {
    const store: Store = {
        programs: [],
        runs: [],
        orgs: [],
        relationships: [],
        evidence: [],
        events: [],
        agreements: [],
        nextId: 1,
    };
    store.programs.push({
        id: "prog-sample",
        name: "EU specialty coffee",
        offering: "Single-origin roasted specialty coffee, 250 g retail bags and 1 kg foodservice",
        categories: ["specialty coffee", "roasted coffee"],
        hsCodes: ["0901"],
        targetTerritories: [
            { country: "DE" },
            { country: "NL", region: "Amsterdam", radiusMeters: 20000 },
            { country: "FR" },
        ],
        partnerKinds: ["importer", "distributor", "retailer"],
        constraints: "MOQ 200 kg; EU organic preferred; exclusivity only per country for importers",
        knownPartnerDomains: ["current-importer.example"],
        status: "active",
        createdAt: daysAgo(12),
    });
    return store;
}

const SAMPLE_ORGS: Array<
    Omit<OrgDto, "id" | "country"> & {
        country: string;
        kind: RelationshipDto["kind"];
        stage: RelationshipStage;
        fit: number;
        flagged?: boolean;
        days: number;
        nextAction?: string;
        owner?: string;
    }
> = [
    {
        name: "Nordwind Import GmbH",
        domain: "nordwind-import.example",
        country: "DE",
        region: null,
        city: "Hamburg",
        roles: ["importer", "distributor"],
        categories: ["coffee"],
        sizeBand: "medium",
        description: "Importer and distributor of specialty coffee",
        kgEntityId: 42,
        lastEnrichedAt: daysAgo(2),
        kind: "importer",
        stage: "in_conversation",
        fit: 84,
        days: 3,
        nextAction: "Send 3 sample SKUs + price list",
        owner: "timothy",
    },
    {
        name: "Dutch Delights B.V.",
        domain: "dutch-delights.example",
        country: "NL",
        region: null,
        city: "Amsterdam",
        roles: ["distributor", "importer"],
        categories: ["coffee"],
        sizeBand: "small",
        description: null,
        kgEntityId: null,
        lastEnrichedAt: daysAgo(2),
        kind: "distributor",
        stage: "contacted",
        fit: 71,
        days: 19,
        owner: "timothy",
    },
    {
        name: "Maison Comptoir SAS",
        domain: "maison-comptoir.example",
        country: "FR",
        region: null,
        city: "Lyon",
        roles: ["importer", "agent"],
        categories: ["épicerie"],
        sizeBand: "medium",
        description: null,
        kgEntityId: null,
        lastEnrichedAt: daysAgo(2),
        kind: "importer",
        stage: "researched",
        fit: 66,
        days: 2,
    },
    {
        name: "Canal Concept Stores",
        domain: "canal-concept.example",
        country: "NL",
        region: "Amsterdam",
        city: "Amsterdam",
        roles: ["retailer"],
        categories: [],
        sizeBand: "micro",
        description: null,
        kgEntityId: null,
        lastEnrichedAt: daysAgo(2),
        kind: "retailer",
        stage: "researched",
        fit: 38,
        days: 2,
    },
    {
        name: "Shady Trading Ltd",
        domain: "shady-trading.example",
        country: "DE",
        region: null,
        city: "Berlin",
        roles: ["importer"],
        categories: [],
        sizeBand: "small",
        description: null,
        kgEntityId: null,
        lastEnrichedAt: daysAgo(2),
        kind: "importer",
        stage: "researched",
        fit: 52,
        flagged: true,
        days: 2,
    },
    {
        name: "Alpen Vertrieb AG",
        domain: "alpen-vertrieb.example",
        country: "DE",
        region: null,
        city: "München",
        roles: ["distributor"],
        categories: ["coffee"],
        sizeBand: "medium",
        description: null,
        kgEntityId: null,
        lastEnrichedAt: daysAgo(40),
        kind: "distributor",
        stage: "active",
        fit: 78,
        days: 40,
        owner: "timothy",
    },
];

let store = seed();

function id(prefix: string): string {
    return `${prefix}-${store.nextId++}`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function addEvent(
    relationshipId: string,
    type: EventDto["type"],
    payload: Record<string, unknown>,
    touch = true
): EventDto {
    const event: EventDto = {
        id: store.nextId++,
        type,
        payload,
        actorUserId: "you",
        ref: null,
        occurredAt: now(),
    };
    store.events.push(event);
    const rel = store.relationships.find(r => r.id === relationshipId);
    if (rel && touch) rel.lastActivityAt = event.occurredAt;
    (event as EventDto & { relationshipId: string }).relationshipId = relationshipId;
    return event;
}

function createSampleRun(programId: string, maxCandidates: number): RunDto {
    const program = store.programs.find(p => p.id === programId)!;
    const created: string[] = [];
    for (const sample of SAMPLE_ORGS.slice(0, maxCandidates)) {
        let org = store.orgs.find(o => o.domain === sample.domain);
        if (!org) {
            org = {
                id: id("org"),
                name: sample.name,
                domain: sample.domain,
                country: sample.country,
                region: sample.region,
                city: sample.city,
                roles: sample.roles,
                categories: sample.categories,
                sizeBand: sample.sizeBand,
                description: sample.description,
                kgEntityId: sample.kgEntityId,
                lastEnrichedAt: sample.lastEnrichedAt,
            };
            store.orgs.push(org);
        }
        if (
            store.relationships.some(
                r => r.orgId === org.id && r.programId === programId && r.kind === sample.kind
            )
        )
            continue;
        const rel: RelationshipDto = {
            id: id("rel"),
            programId,
            orgId: org.id,
            kind: sample.kind,
            territory: { country: sample.country },
            stage: sample.stage,
            fitScore: sample.fit,
            fitRationale: `${sample.name} scores ${sample.fit}/100 as a ${sample.kind}. Strongest: category overlap. Main reservation: ${sample.fit > 70 ? "evidence freshness" : "role not confirmed"}.`,
            fitBreakdown: {
                categoryOverlap: Math.round(sample.fit * 0.25),
                territoryMatch: 20,
                roleMatch: sample.fit > 60 ? 20 : 10,
                evidenceDepth: Math.min(15, Math.round(sample.fit / 6)),
                freshness: 5,
                sizeFit: 3,
                knownSignal: sample.kgEntityId ? 10 : 0,
                total: sample.fit,
            },
            riskFlags: sample.flagged
                ? [
                      "compliance screening flagged (advisory)",
                      "Appears on a watchlist screen; confirm identity before any contact.",
                  ]
                : sample.fit < 40
                  ? ["thin evidence", "role not confirmed"]
                  : [],
            screening: sample.flagged
                ? {
                      status: "flagged",
                      provider: "fixture-screen",
                      checkedAt: now(),
                      flags: [
                          {
                              entityId: "fx-1",
                              matchedName: sample.name,
                              score: 0.86,
                              topics: ["sanction"],
                              datasets: ["fixture_watchlist"],
                          },
                      ],
                  }
                : { status: "clear", provider: "fixture-screen", checkedAt: now(), flags: [] },
            dossier: {
                summary: `${sample.name} is a ${sample.roles.join(" and ")} based in ${sample.city}, supplying independent shops and regional chains across ${sample.country}. It carries two adjacent roasters and lists a purchasing contact.`,
                roles: sample.roles as PartnerKind[],
                brandsCarried: [
                    { brand: "Beta Roasters", evidenceIds: [1] },
                    { brand: "Gamma Coffee", evidenceIds: [1] },
                ],
                territories: [{ territory: sample.country, evidenceIds: [2] }],
                retailCoverage: [{ account: "independent cafés", evidenceIds: [2] }],
                certifications:
                    sample.fit > 60 ? [{ certification: "EU organic", evidenceIds: [3] }] : [],
                decisionMakers: [{ title: "Head of Purchasing", evidenceIds: [4] }],
                contactChannels: [
                    { channel: "email", value: `import@${sample.domain}`, evidenceIds: [4] },
                ],
                risks: sample.flagged
                    ? [
                          {
                              risk: "Appears on a watchlist screen; confirm identity before any contact.",
                              evidenceIds: [2],
                          },
                      ]
                    : [],
                sizeBand: (sample.sizeBand ?? "unknown") as
                    | "micro"
                    | "small"
                    | "medium"
                    | "large"
                    | "unknown",
                openQuestions:
                    sample.fit < 40 ? ["Range and ordering terms are not published."] : [],
            } as RelationshipDto["dossier"],
            ownerUserId: sample.owner ?? null,
            nextAction: sample.nextAction ?? null,
            nextActionAt: sample.nextAction
                ? new Date(Date.now() + 2 * 86_400_000).toISOString()
                : null,
            lastActivityAt: daysAgo(sample.days),
            dossierDocumentId: 900 + store.nextId,
            source: "discovery",
            stageChangedAt: daysAgo(sample.days),
            createdAt: daysAgo(sample.days + 1),
        };
        store.relationships.push(rel);
        created.push(rel.id);
        for (const [i, e] of [
            {
                kind: "brands_carried",
                claim: `Carries Beta Roasters and Gamma Coffee.`,
                quote: "We carry Beta Roasters, Gamma Coffee.",
                path: "/brands",
            },
            {
                kind: "retail_coverage",
                claim: `Supplies independent cafés across ${sample.country}.`,
                quote: `We supply independent cafés across ${sample.country}.`,
                path: "/",
            },
            {
                kind: "certification",
                claim: "Holds EU organic.",
                quote: "Certified: EU organic.",
                path: "/",
            },
            {
                kind: "contact",
                claim: `Public mailbox import@${sample.domain}.`,
                quote: `Contact: import@${sample.domain}`,
                path: "/",
            },
        ].entries()) {
            const ev: EvidenceDto & { orgId: string } = {
                id: store.nextId++,
                orgId: org.id,
                kind: e.kind,
                claim: e.claim,
                sourceUrl: `https://${sample.domain}${e.path}`,
                quote: e.quote,
                confidence: 0.9,
                capturedAt: now(),
            };
            if (sample.fit < 40 && i > 1) continue;
            store.evidence.push(ev);
        }
        addEvent(
            rel.id,
            "researched",
            { runId: "sample", status: "ok", fitScore: sample.fit, evidence: 4, turns: 3 },
            false
        );
        if (ORDER.indexOf(sample.stage) >= ORDER.indexOf("contacted"))
            addEvent(rel.id, "stage_changed", { from: "researched", to: "contacted" }, false);
        if (sample.stage === "in_conversation")
            addEvent(rel.id, "stage_changed", { from: "contacted", to: "in_conversation" }, false);
        if (sample.stage === "active") {
            const agreement: AgreementDto & { relationshipId: string } = {
                id: id("agr"),
                relationshipId: rel.id,
                territory: [{ country: sample.country }],
                exclusivity: "semi",
                startsOn: "2026-06-01",
                endsOn: "2027-05-31",
                terms: { notes: "Tier B pricing, MOQ 200 kg" },
                documentId: null,
                renewalReminderAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            };
            store.agreements.push(agreement);
            addEvent(
                rel.id,
                "agreement_signed",
                { agreementId: agreement.id, exclusivity: "semi" },
                false
            );
        }
    }
    const run: RunDto = {
        id: id("run"),
        programId,
        status: "completed",
        options: { maxCandidates, mode: "fixture" },
        plan: {
            adjacentBrands: ["Beta Roasters", "Gamma Coffee", "Bergland Foods"],
            strategy: "Sample plan: one canned query per territory × partner kind.",
            queries: program.targetTerritories.flatMap(t =>
                program.partnerKinds.map(k => ({
                    kind: "web",
                    label: "fixture",
                    query: `${k} specialty coffee country:${t.country}`,
                }))
            ),
        },
        summary: {
            sources: [
                {
                    source: "place",
                    queries: 0,
                    results: 0,
                    status: "skipped",
                    detail: "place search not configured",
                },
                { source: "trade", queries: 3, results: 4, status: "ok" },
                { source: "web", queries: 9, results: created.length, status: "ok" },
            ],
            mentions: created.length * 2,
            resolved: created.length,
            excluded: 1,
            shortlisted: created.length,
            enriched: created.length,
            gateRejections: 0,
            budgetExhausted: 0,
            screened: created.length,
            flagged: 1,
            published: created.length,
            degraded: false,
            warnings: [],
            tokens: {
                input: 520 * created.length,
                output: 120 * created.length,
                total: 640 * created.length,
            },
            wallMs: 1800,
        },
        candidateOrgIds: created,
        creditsUsed: 0,
        errorMessage: null,
        createdAt: now(),
        startedAt: now(),
        completedAt: now(),
    };
    store.runs.unshift(run);
    return run;
}

function stale(rel: RelationshipDto): boolean {
    const thresholds: Partial<Record<RelationshipStage, number>> = {
        contacted: 14,
        in_conversation: 14,
        qualified: 21,
        negotiating: 21,
        contracted: 45,
        active: 90,
    };
    const days = thresholds[rel.stage];
    if (!days) return false;
    const last = new Date(rel.lastActivityAt ?? rel.stageChangedAt).getTime();
    return Date.now() - last > days * 86_400_000;
}

function item(rel: RelationshipDto): PartnerItemDto {
    const org = store.orgs.find(o => o.id === rel.orgId)!;
    return {
        relationship: rel,
        org,
        evidenceCount: store.evidence.filter(
            e => (e as EvidenceDto & { orgId: string }).orgId === org.id
        ).length,
        stale: stale(rel),
    };
}

function dashboard(programId: string): DashboardDto {
    const program = store.programs.find(p => p.id === programId)!;
    const items = store.relationships.filter(r => r.programId === programId).map(item);
    const counts = Object.fromEntries([...ORDER, "declined", "dormant"].map(s => [s, 0])) as Record<
        RelationshipStage,
        number
    >;
    for (const i of items) counts[i.relationship.stage] += 1;
    const funnelStages: RelationshipStage[] = [
        "candidate",
        "contacted",
        "in_conversation",
        "qualified",
        "negotiating",
        "contracted",
        "active",
    ];
    const funnel = funnelStages.map(stage => ({
        stage,
        count: items.filter(i => ORDER.indexOf(i.relationship.stage) >= ORDER.indexOf(stage))
            .length,
    }));
    const week = Date.now() + 7 * 86_400_000;
    const coverage = program.targetTerritories.flatMap(t =>
        program.partnerKinds.map(kind => {
            const cell = items.filter(
                i =>
                    (i.relationship.territory?.country ?? i.org.country) === t.country &&
                    i.relationship.kind === kind
            );
            return {
                country: t.country,
                kind,
                covered: cell.filter(i => ["contracted", "active"].includes(i.relationship.stage))
                    .length,
                inPipeline: cell.filter(i =>
                    ["contacted", "in_conversation", "qualified", "negotiating"].includes(
                        i.relationship.stage
                    )
                ).length,
                candidates: cell.filter(i =>
                    ["candidate", "researched"].includes(i.relationship.stage)
                ).length,
                targeted: true,
            };
        })
    );
    return {
        programId,
        counts,
        funnel,
        inPipeline: items.filter(i =>
            ["contacted", "in_conversation", "qualified", "negotiating"].includes(
                i.relationship.stage
            )
        ).length,
        stale: items.filter(i => i.stale).length,
        dueThisWeek: items.filter(
            i =>
                i.relationship.nextActionAt &&
                new Date(i.relationship.nextActionAt).getTime() <= week
        ).length,
        renewalsDue: store.agreements.filter(
            a => a.renewalReminderAt && new Date(a.renewalReminderAt).getTime() <= week
        ).length,
        coverage,
        coveredCells: coverage.filter(c => c.covered > 0).length,
        targetedCells: coverage.length,
        medianDaysInStage: { contacted: 6, in_conversation: 11 },
        attention: items.filter(
            i =>
                i.stale ||
                (i.relationship.nextActionAt &&
                    new Date(i.relationship.nextActionAt).getTime() <= week)
        ),
    };
}

function transition(
    rel: RelationshipDto,
    to: RelationshipStage,
    patch: { ownerUserId?: string | null; nextAction?: string | null }
): Response | null {
    if (rel.stage === to)
        return json({ error: `Relationship is already "${to}".`, code: "same_stage" }, 409);
    if (!ALLOWED[rel.stage].includes(to))
        return json(
            {
                error: `Cannot move from "${rel.stage}" to "${to}". Allowed: ${ALLOWED[rel.stage].join(", ")}.`,
                code: "transition_not_allowed",
            },
            409
        );
    const owner = patch.ownerUserId !== undefined ? patch.ownerUserId : rel.ownerUserId;
    const next = patch.nextAction !== undefined ? patch.nextAction : rel.nextAction;
    const rank = ORDER.indexOf(to);
    if (rank >= ORDER.indexOf("contacted") && !owner)
        return json(
            {
                error: `An owner is required from "contacted" onward (entering "${to}").`,
                code: "owner_required",
            },
            409
        );
    if (rank >= ORDER.indexOf("in_conversation") && rank < ORDER.indexOf("contracted") && !next)
        return json(
            {
                error: `A next action is required from "in_conversation" onward (entering "${to}").`,
                code: "next_action_required",
            },
            409
        );
    if (
        rank >= ORDER.indexOf("contracted") &&
        !store.agreements.some(
            a => (a as AgreementDto & { relationshipId: string }).relationshipId === rel.id
        )
    )
        return json(
            { error: `An agreement is required to enter "${to}".`, code: "agreement_required" },
            409
        );
    addEvent(rel.id, "stage_changed", { from: rel.stage, to });
    rel.stage = to;
    rel.stageChangedAt = now();
    return null;
}

export function resetSimulator(): void {
    store = seed();
}

/** Route one `/api/distribution/*` request. Returns null for anything else. */
export async function simulate(url: string, init?: RequestInit): Promise<Response | null> {
    const u = new URL(url, "http://localhost");
    if (!u.pathname.startsWith("/api/distribution")) return null;
    const path = u.pathname.replace("/api/distribution", "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    await new Promise(r => setTimeout(r, 120));

    if (path === "/programs" && method === "GET") return json({ programs: store.programs });
    if (path === "/programs" && method === "POST") {
        const program: ProgramDto = {
            id: id("prog"),
            status: "active",
            createdAt: now(),
            ...(body as Omit<ProgramDto, "id" | "status" | "createdAt">),
        };
        store.programs.unshift(program);
        return json({ program }, 201);
    }
    let m = /^\/programs\/([^/]+)$/.exec(path);
    if (m && method === "PATCH") {
        const program = store.programs.find(p => p.id === m![1]);
        if (!program) return json({ error: "Not found" }, 404);
        Object.assign(program, body);
        return json({ program });
    }
    if (path === "/runs" && method === "GET")
        return json({
            runs: store.runs.filter(r => r.programId === u.searchParams.get("programId")),
        });
    if (path === "/runs" && method === "POST") {
        const options = (body.options ?? {}) as { maxCandidates?: number; mode?: string };
        const programId = String(body.programId);
        if (options.mode === "fixture")
            return json({ run: createSampleRun(programId, options.maxCandidates ?? 25) }, 201);
        const run: RunDto = {
            id: id("run"),
            programId,
            status: "planning",
            options: { maxCandidates: options.maxCandidates ?? 25, mode: "live" },
            plan: null,
            summary: null,
            candidateOrgIds: null,
            creditsUsed: 0,
            errorMessage: null,
            createdAt: now(),
            startedAt: now(),
            completedAt: null,
        };
        store.runs.unshift(run);
        // A live run in the harness fails visibly after a moment: there is no worker here.
        setTimeout(() => {
            run.status = "failed";
            run.errorMessage =
                "Preview harness: live runs need the worker and provider keys. Use sample data here.";
            run.completedAt = now();
        }, 4000);
        return json({ run }, 202);
    }
    if (path === "/dashboard")
        return json({ dashboard: dashboard(u.searchParams.get("programId")!) });
    if (path === "/partners" && method === "GET") {
        const programId = u.searchParams.get("programId");
        const stages = (u.searchParams.get("stage") ?? "").split(",").filter(Boolean);
        const kind = u.searchParams.get("kind");
        const minFit = u.searchParams.get("minFit");
        const q = (u.searchParams.get("q") ?? "").toLowerCase();
        const order = u.searchParams.get("order") ?? "fit";
        let items = store.relationships
            .filter(r => !programId || r.programId === programId)
            .map(item);
        if (stages.length) items = items.filter(i => stages.includes(i.relationship.stage));
        if (kind) items = items.filter(i => i.relationship.kind === kind);
        if (minFit) items = items.filter(i => (i.relationship.fitScore ?? -1) >= Number(minFit));
        if (q) items = items.filter(i => i.org.name.toLowerCase().includes(q));
        if (u.searchParams.get("stale") === "1") items = items.filter(i => i.stale);
        items.sort((a, b) =>
            order === "activity"
                ? new Date(b.relationship.lastActivityAt ?? 0).getTime() -
                  new Date(a.relationship.lastActivityAt ?? 0).getTime()
                : order === "stage"
                  ? ORDER.indexOf(a.relationship.stage) - ORDER.indexOf(b.relationship.stage)
                  : (b.relationship.fitScore ?? -1) - (a.relationship.fitScore ?? -1)
        );
        return json({ partners: items, pagination: { limit: 200, offset: 0 } });
    }
    m = /^\/partners\/([^/]+)$/.exec(path);
    if (m) {
        const rel = store.relationships.find(r => r.id === m![1]);
        if (!rel) return json({ error: "Not found" }, 404);
        const org = store.orgs.find(o => o.id === rel.orgId)!;
        return json({
            relationship: rel,
            org,
            evidence: store.evidence.filter(
                e => (e as EvidenceDto & { orgId: string }).orgId === org.id
            ),
            events: store.events
                .filter(e => (e as EventDto & { relationshipId: string }).relationshipId === rel.id)
                .slice()
                .reverse(),
            agreements: store.agreements.filter(
                a => (a as AgreementDto & { relationshipId: string }).relationshipId === rel.id
            ),
        });
    }
    m = /^\/relationships\/([^/]+)$/.exec(path);
    if (m && method === "PATCH") {
        const rel = store.relationships.find(r => r.id === m![1]);
        if (!rel) return json({ error: "Not found" }, 404);
        const patch = body as {
            stage?: RelationshipStage;
            ownerUserId?: string | null;
            nextAction?: string | null;
            nextActionAt?: string | null;
            note?: string;
        };
        if (patch.stage && patch.stage !== rel.stage) {
            const refused = transition(rel, patch.stage, patch);
            if (refused) return refused;
        }
        if (patch.ownerUserId !== undefined) rel.ownerUserId = patch.ownerUserId;
        if (patch.nextAction !== undefined) rel.nextAction = patch.nextAction;
        if (patch.nextActionAt !== undefined) rel.nextActionAt = patch.nextActionAt;
        if (patch.note) addEvent(rel.id, "note", { text: patch.note });
        return json({ relationship: rel });
    }
    m = /^\/relationships\/([^/]+)\/events$/.exec(path);
    if (m && method === "POST") {
        const rel = store.relationships.find(r => r.id === m![1]);
        if (!rel) return json({ error: "Not found" }, 404);
        return json(
            {
                event: addEvent(rel.id, body.type as EventDto["type"], asRecord(body.payload)),
            },
            201
        );
    }
    m = /^\/relationships\/([^/]+)\/agreements$/.exec(path);
    if (m && method === "POST") {
        const relationshipId = m[1];
        const rel = store.relationships.find(r => r.id === relationshipId);
        if (!rel) return json({ error: "Not found" }, 404);
        const agreement = {
            id: id("agr"),
            relationshipId: rel.id,
            territory: null,
            exclusivity: "none",
            startsOn: null,
            endsOn: null,
            terms: {},
            documentId: null,
            renewalReminderAt: null,
            ...(body as Partial<AgreementDto>),
        } as AgreementDto & { relationshipId: string };
        store.agreements.push(agreement);
        addEvent(rel.id, "agreement_signed", {
            agreementId: agreement.id,
            exclusivity: agreement.exclusivity,
        });
        return json({ agreement }, 201);
    }
    if (path === "/import" && method === "POST") {
        const rows =
            (body.rows as Array<{
                name: string;
                domain?: string;
                country?: string;
                kind: RelationshipDto["kind"];
                stage?: RelationshipStage;
            }>) ?? [];
        let created = 0;
        for (const row of rows) {
            const org: OrgDto = {
                id: id("org"),
                name: row.name,
                domain: row.domain ?? null,
                country: row.country?.toUpperCase() ?? null,
                region: null,
                city: null,
                roles: [row.kind],
                categories: [],
                sizeBand: null,
                description: null,
                kgEntityId: null,
                lastEnrichedAt: null,
            };
            store.orgs.push(org);
            const rel: RelationshipDto = {
                id: id("rel"),
                programId: String(body.programId),
                orgId: org.id,
                kind: row.kind,
                territory: org.country ? { country: org.country } : null,
                stage: row.stage ?? "active",
                fitScore: null,
                fitRationale: null,
                fitBreakdown: null,
                riskFlags: [],
                screening: null,
                dossier: null,
                ownerUserId: "you",
                nextAction: null,
                nextActionAt: null,
                lastActivityAt: now(),
                dossierDocumentId: null,
                source: "import",
                stageChangedAt: now(),
                createdAt: now(),
            };
            store.relationships.push(rel);
            addEvent(rel.id, "imported", { stage: rel.stage });
            created += 1;
            const program = store.programs.find(p => p.id === body.programId);
            if (program && org.domain && !program.knownPartnerDomains.includes(org.domain))
                program.knownPartnerDomains.push(org.domain);
        }
        return json({ created, existing: 0 }, 201);
    }
    if (path === "/outreach" && method === "POST") {
        const ids = Array.isArray(body.relationshipIds) ? (body.relationshipIds as string[]) : [];
        const included: string[] = [];
        const skipped: Array<{ relationshipId: string; reason: string }> = [];
        const program = store.programs.find(p => p.id === body.programId);
        for (const relId of ids) {
            const rel = store.relationships.find(r => r.id === relId);
            const org = rel ? store.orgs.find(o => o.id === rel.orgId) : undefined;
            if (!rel || !org) {
                skipped.push({ relationshipId: relId, reason: "not found in this program" });
                continue;
            }
            if (["contracted", "active", "declined"].includes(rel.stage)) {
                skipped.push({ relationshipId: relId, reason: `stage is ${rel.stage}` });
                continue;
            }
            if (org.domain && program?.knownPartnerDomains.includes(org.domain)) {
                skipped.push({ relationshipId: relId, reason: "existing partner (excluded)" });
                continue;
            }
            included.push(relId);
            addEvent(rel.id, "note", {
                text: "Outreach campaign #77 drafted (awaiting approval in Email).",
                campaignId: 77,
            });
        }
        if (included.length === 0) return json({ error: "No eligible recipients", skipped }, 422);
        return json({ campaignId: 77, status: "pending_approval", included, skipped }, 201);
    }
    return json({ error: `Preview harness: unhandled ${method} ${path}` }, 404);
}
