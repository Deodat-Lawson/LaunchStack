/**
 * What is known about who fits a segment is kept between runs, against a real
 * database: the fit check's verdicts (one row per company, research outranks
 * a later look at the listing), people's own decisions read from the stage of
 * the deal, a second run of a segment that starts from what the first one
 * learned, and a segment whose area moved, which starts the fit check's
 * verdicts afresh. Gated like the other integration suites.
 */
import { eq } from "drizzle-orm";

import { configureDatabase } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    enrichCandidate,
    prepareRun,
    segmentKey,
    type DistributionPorts,
} from "@launchstack/pipelines/distribution";
import {
    createProgram,
    createRun,
    importPartners,
    listFitExamples,
    listPartners,
    saveFitVerdicts,
    transitionStage,
    updateProgram,
} from "@launchstack/pipelines/distribution/db";
import { distributionFitVerdicts } from "@launchstack/pipelines/distribution/schema";
import type { CompanyHit } from "@launchstack/tools/web-research";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));
jest.mock("@launchstack/tools/company-context", () => ({
    getCompanyIdentity: async () => ({
        data: {
            name: "Seller BV",
            industry: "Logistics software",
            description: "",
            categories: [],
        },
    }),
    buildCompanyKnowledgeContext: async () => "",
    formatCompanyIdentity: () => "Company: Seller BV.",
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

/**
 * A deterministic stand-in for an embedding model, as the pipeline's own tests
 * use (its semantic.fixture): each word is hashed into one of 512 dimensions,
 * so texts that share words point the same way.
 */
const STOP = new Set(["a", "an", "and", "the", "of", "for", "in", "to", "that", "this", "would"]);
const fakeEmbed: NonNullable<DistributionPorts["embed"]> = async texts =>
    texts.map(text => {
        const vector = new Array<number>(512).fill(0);
        for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
            if (raw.length < 2 || STOP.has(raw)) continue;
            const word = raw.replace(/(ies|es|s)$/, "");
            let hash = 2166136261;
            for (let i = 0; i < word.length; i++) {
                hash ^= word.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            vector[Math.abs(hash) % 512]! += 1;
        }
        // Any two business descriptions share a little, as with a real model.
        vector[0]! += 1;
        return vector;
    });

// Two kinds of company. More of the brief's own words sit in the agencies'
// listings, so the fixed ranking puts every agency first; only the warehouse
// operators would buy picking robots.
const AGENCY =
    "Picking robots and fulfilment warehouses: software consultancy and marketing agency for webshops.";
const OPERATOR = "Fulfilment warehouses operator: picking, storage and shipping for webshops.";
const isOperator = (name: string): boolean => name.includes("Operator");

function pool(tag: string, each = 30): CompanyHit[] {
    const hit = (domain: string, title: string, description: string): CompanyHit => ({
        title,
        url: `https://${domain}/`,
        domain,
        description,
    });
    return [
        ...Array.from({ length: each }, (_, i) =>
            hit(`${tag}-agency-${i}.example`, `${tag} Agency ${i}`, AGENCY)
        ),
        ...Array.from({ length: each }, (_, i) =>
            hit(`${tag}-operator-${i}.example`, `${tag} Operator ${i}`, OPERATOR)
        ),
    ];
}

function ports(companies: CompanyHit[], rounds: string[][]): DistributionPorts {
    return {
        model: { respond: jest.fn() } as unknown as DistributionPorts["model"],
        fetchPage: jest.fn(),
        searchWeb: async () => {
            throw new Error("discovery must use company search when it is configured");
        },
        searchCompanies: async query => (query.startsWith("Companies similar to") ? [] : companies),
        describeCompanies: async () => [],
        searchPlaces: null,
        tradeData: null,
        compliance: null,
        publishDossier: null,
        debitCredits: null,
        writeRationale: null,
        creditsPerCandidate: 0,
        plan: async () => ({
            plan: {
                adjacentBrands: [],
                strategy: "",
                queries: [
                    {
                        kind: "web",
                        territory: { country: "NL" },
                        partnerKind: "distributor",
                        query: "fulfilment warehouses Netherlands",
                        label: "directory",
                        rationale: "r",
                    },
                ],
            },
            playbookHash: "test",
        }),
        embed: fakeEmbed,
        judgeFit: async ({ candidates }) => {
            rounds.push(candidates.map(c => c.name));
            return new Map(
                candidates.map(c => [
                    c.id,
                    isOperator(c.name)
                        ? { fit: true, reason: "Runs a warehouse." }
                        : { fit: false, reason: "An agency." },
                ])
            );
        },
    };
}

describeDb("fit verdicts between runs", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;

    const newProgram = (name: string) =>
        createProgram({
            companyId,
            userId: "u1",
            input: {
                name,
                offering: "Picking robots for fulfilment warehouses",
                categories: ["fulfilment"],
                hsCodes: [],
                targetTerritories: [{ country: "NL" }],
                partnerKinds: ["distributor"],
                constraints: null,
                knownPartnerDomains: [],
                customerDomains: [],
            },
        });

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const [row] = await testDb.db
            .insert(company)
            .values({ name: "Seller BV", numberOfEmployees: "5" })
            .returning();
        companyId = BigInt(row!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    it("keeps one verdict per company, and research outranks a later look at the listing", async () => {
        const program = await newProgram("Verdict rows");
        const key = segmentKey(program);
        const verdict = (name: string, fit: boolean) => ({
            resolveKey: `d:${name}.example`,
            name,
            text: `${name}. ${fit ? OPERATOR : AGENCY}`,
            fit,
            reason: fit ? "Runs a warehouse." : "An agency.",
        });
        const save = (
            basis: "listing" | "research",
            segment: string,
            ...verdicts: ReturnType<typeof verdict>[]
        ) =>
            saveFitVerdicts({
                companyId,
                programId: program.id,
                runId: null,
                basis,
                segmentKey: segment,
                verdicts,
            });
        const examples = async (segment = key) =>
            Object.fromEntries(
                (
                    await listFitExamples({ companyId, programId: program.id, segmentKey: segment })
                ).map(e => [e.resolveKey, `${e.source}:${e.good}`])
            );

        await save("listing", key, verdict("a", true), verdict("b", false), verdict("c", true));
        expect(await examples()).toEqual({
            "d:a.example": "listing:true",
            "d:b.example": "listing:false",
            "d:c.example": "listing:true",
        });

        // Research rules one of them out; a later run's look at the same listing does not undo that.
        await save("research", key, verdict("a", false));
        await save("listing", key, verdict("a", true), verdict("b", true));
        expect(await examples()).toEqual({
            "d:a.example": "research:false",
            "d:b.example": "listing:true",
            "d:c.example": "listing:true",
        });
        const rows = await testDb.db
            .select()
            .from(distributionFitVerdicts)
            .where(eq(distributionFitVerdicts.programId, program.id));
        expect(rows).toHaveLength(3);

        // The segment is rewritten: verdicts on the old wording are not what a run starts from,
        // and a verdict under the new wording replaces even a research one.
        const rewritten = segmentKey({
            ...program,
            offering: "Shelving for fulfilment warehouses",
        });
        expect(rewritten).not.toBe(key);
        expect(await examples(rewritten)).toEqual({});
        await save("listing", rewritten, verdict("a", true));
        expect(await examples(rewritten)).toEqual({ "d:a.example": "listing:true" });
        expect(await examples()).toEqual({
            "d:b.example": "listing:true",
            "d:c.example": "listing:true",
        });
    });

    it("starts the second run of a segment from the first run's verdicts and from people's decisions", async () => {
        const program = await newProgram("Two runs");
        const key = segmentKey(program);
        const start = async (companies: CompanyHit[]) => {
            const run = await createRun({
                companyId,
                programId: program.id,
                userId: "u1",
                options: { maxCandidates: 25, mode: "live" },
            });
            const rounds: string[][] = [];
            const prepared = await prepareRun(
                { runId: run.id, companyId, programId: program.id },
                ports(companies, rounds)
            );
            return { run, rounds, prepared };
        };

        // Run 1 knows nothing: it learns what fits from its own fit checks.
        const first = await start(pool("First"));
        expect(first.prepared.fitCheck).toMatchObject({ learning: true, startedFrom: 0 });
        const firstAsked = first.rounds.flat();
        const stored = await testDb.db
            .select()
            .from(distributionFitVerdicts)
            .where(eq(distributionFitVerdicts.programId, program.id));
        expect(stored).toHaveLength(firstAsked.length);
        expect(stored.every(row => row.fit === isOperator(row.name))).toBe(true);
        expect(stored.every(row => row.basis === "listing" && row.runId === first.run.id)).toBe(
            true
        );
        expect(stored.every(row => row.segmentKey === key)).toBe(true);

        // A person's decisions: one shortlisted operator is not a fit after all, one is
        // qualified, and a customer won elsewhere is imported.
        const leads = await listPartners(companyId, { programId: program.id });
        expect(leads.length).toBeGreaterThanOrEqual(25);
        const [notAFit, qualified] = leads;
        await transitionStage({
            companyId,
            relationshipId: notAFit!.relationship.id,
            to: "lost",
            actorUserId: "u1",
        });
        await transitionStage({
            companyId,
            relationshipId: qualified!.relationship.id,
            to: "qualified",
            actorUserId: "u1",
        });
        await importPartners({
            companyId,
            programId: program.id,
            userId: "u1",
            rows: [
                {
                    name: "Won Operator",
                    domain: "won-operator.example",
                    kind: "distributor",
                    stage: "won",
                },
            ],
        });
        const examples = await listFitExamples({
            companyId,
            programId: program.id,
            segmentKey: key,
        });
        const by = new Map(examples.map(e => [e.resolveKey, e]));
        expect(by.get(notAFit!.org.resolveKey)).toMatchObject({ source: "person", good: false });
        expect(by.get(qualified!.org.resolveKey)).toMatchObject({ source: "person", good: true });
        expect(by.get("d:won-operator.example")).toMatchObject({ source: "person", good: true });
        // One verdict per company: the person's replaces the fit check's.
        expect(examples).toHaveLength(firstAsked.length + 1);

        // Run 2 meets sixty companies it has never seen, and already knows which kind fits.
        const second = await start(pool("Second"));
        expect(second.prepared.fitCheck).toMatchObject({
            learning: true,
            startedFrom: firstAsked.length + 1,
        });
        const agencies = (asked: string[]) => asked.filter(name => !isOperator(name)).length;
        expect(agencies(second.rounds.flat())).toBeLessThan(agencies(firstAsked));
        expect(second.rounds[0]!.filter(isOperator).length).toBeGreaterThanOrEqual(8);
        expect(second.prepared.fitCheck!.checked).toBeLessThanOrEqual(
            first.prepared.fitCheck!.checked
        );
        expect(second.prepared.candidateRelationshipIds).toHaveLength(25);
    });

    it("keeps what research found about a company over the look at its listing", async () => {
        const program = await newProgram("Researched");
        const run = await createRun({
            companyId,
            programId: program.id,
            userId: "u1",
            options: { maxCandidates: 25, mode: "live" },
        });
        const ctx = { runId: run.id, companyId, programId: program.id };
        const prepared = await prepareRun(ctx, ports(pool("Researched"), []));
        const key = segmentKey(program, run.options);

        // The first shortlisted company: the listing said it fits.
        const relationshipId = prepared.candidateRelationshipIds[0]!;
        const partner = (await listPartners(companyId, { programId: program.id })).find(
            item => item.relationship.id === relationshipId
        )!;
        const rowOf = async () => {
            const rows = await testDb.db
                .select()
                .from(distributionFitVerdicts)
                .where(eq(distributionFitVerdicts.programId, program.id));
            return rows.find(row => row.resolveKey === partner.org.resolveKey)!;
        };
        expect(await rowOf()).toMatchObject({ basis: "listing", fit: true, segmentKey: key });

        // Research finds nothing to cite; the fit check on what it found says no.
        const asked: string[] = [];
        await enrichCandidate(
            ctx,
            {
                ...ports([], []),
                profile: async () => ({
                    outcome: { status: "gate_failed", dossier: null, errors: [] },
                    evidence: [],
                    fetchedUrls: [],
                    turns: 0,
                    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                    playbookHash: "test",
                    promptVersion: "test",
                }),
                judgeFit: async ({ candidates }) => {
                    asked.push(...candidates.map(c => c.name));
                    return new Map(
                        candidates.map(c => [c.id, { fit: false, reason: "Closed last year." }])
                    );
                },
            },
            { relationshipId, profile: prepared.profile }
        );
        expect(asked).toEqual([partner.org.name]);
        expect(await rowOf()).toMatchObject({
            basis: "research",
            fit: false,
            reason: "Closed last year.",
            segmentKey: key,
            runId: run.id,
        });

        // The next run reads the listing again and likes it; research still stands.
        const next = await createRun({
            companyId,
            programId: program.id,
            userId: "u1",
            options: { maxCandidates: 25, mode: "live" },
        });
        await saveFitVerdicts({
            companyId,
            programId: program.id,
            runId: next.id,
            basis: "listing",
            segmentKey: key,
            verdicts: [
                {
                    resolveKey: partner.org.resolveKey,
                    name: partner.org.name,
                    text: `${partner.org.name}. ${OPERATOR}`,
                    fit: true,
                    reason: "Runs a warehouse.",
                },
            ],
        });
        expect(await rowOf()).toMatchObject({ basis: "research", fit: false, runId: run.id });
        const known = await listFitExamples({ companyId, programId: program.id, segmentKey: key });
        expect(known.find(e => e.resolveKey === partner.org.resolveKey)).toMatchObject({
            source: "research",
            good: false,
        });
    });

    it("starts the fit check's verdicts afresh when the area moves, and still counts people's decisions", async () => {
        const program = await newProgram("Moved area");
        const start = async (companies: CompanyHit[]) => {
            const run = await createRun({
                companyId,
                programId: program.id,
                userId: "u1",
                options: { maxCandidates: 25, mode: "live" },
            });
            const rounds: string[][] = [];
            const prepared = await prepareRun(
                { runId: run.id, companyId, programId: program.id },
                ports(companies, rounds)
            );
            return { rounds, prepared };
        };
        const keysStored = async () => {
            const rows = await testDb.db
                .select()
                .from(distributionFitVerdicts)
                .where(eq(distributionFitVerdicts.programId, program.id));
            const counts = new Map<string, number>();
            for (const row of rows)
                counts.set(row.segmentKey, (counts.get(row.segmentKey) ?? 0) + 1);
            return counts;
        };

        // Run 1, in the Netherlands; then a person turns one of its companies away.
        const first = await start(pool("First"));
        const dutch = segmentKey(program);
        const firstAsked = first.rounds.flat().length;
        expect(await keysStored()).toEqual(new Map([[dutch, firstAsked]]));
        const [notAFit] = await listPartners(companyId, { programId: program.id });
        await transitionStage({
            companyId,
            relationshipId: notAFit!.relationship.id,
            to: "lost",
            actorUserId: "u1",
        });

        // The segment moves to Belgium: the fit check was asked "in the Netherlands?" before.
        const moved = await updateProgram(program.id, companyId, {
            targetTerritories: [{ country: "BE" }],
        });
        const belgian = segmentKey(moved!);
        expect(belgian).not.toBe(dutch);
        const known = await listFitExamples({
            companyId,
            programId: program.id,
            segmentKey: belgian,
        });
        // None of run 1's verdicts; the person's own decision still counts.
        expect(known.map(e => [e.resolveKey, e.source, e.good])).toEqual([
            [notAFit!.org.resolveKey, "person", false],
        ]);

        // Run 2 starts from that one decision and keeps its verdicts under the new question.
        const second = await start(pool("Second"));
        expect(second.prepared.fitCheck).toMatchObject({ learning: true, startedFrom: 1 });
        expect(second.rounds[0]).toHaveLength(10);
        const stored = await keysStored();
        expect(stored.get(belgian)).toBe(second.rounds.flat().length);
        expect(stored.get(dutch)).toBe(firstAsked);
    });
});
