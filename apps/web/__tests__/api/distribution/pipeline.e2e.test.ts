/**
 * The pipeline end to end against a real database, with every outside
 * dependency replaced by the fixture ports: profile → plan → gather →
 * resolve → enrich (scripted agent through the real tools and grounding
 * gate) → screen → score → report. This is the "end-to-end dry run" the
 * design asks for (§8), made repeatable. Gated on the local test database.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import {
    buildFixtureWorld,
    createFixturePorts,
    runDistributionPipeline,
    type PublishDossierInput,
} from "@launchstack/pipelines/distribution";
import {
    createProgram,
    createRun,
    getDashboard,
    getRun,
    listEvents,
    listEvidenceForOrg,
    listPartners,
} from "@launchstack/pipelines/distribution/db";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("distribution pipeline end to end (fixture ports, real database)", () => {
    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const published: PublishDossierInput[] = [];
    const debits: number[] = [];

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const [row] = await testDb.db
            .insert(company)
            .values({
                name: "Kōhī Roasters",
                numberOfEmployees: "8",
                description: "Specialty coffee roaster",
            })
            .returning();
        companyId = BigInt(row!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    it("runs all eight stages, excludes known partners, scores and publishes every candidate, and does not duplicate on a second run", async () => {
        const world = buildFixtureWorld("specialty coffee");
        const knownPartner = world.find(o => o.slug === "rheinland-handel")!;
        const program = await createProgram({
            companyId,
            userId: "user-1",
            input: {
                name: "DACH + Benelux coffee",
                offering: "Single-origin roasted specialty coffee",
                categories: ["specialty coffee"],
                hsCodes: ["0901"],
                targetTerritories: [{ country: "DE" }, { country: "NL" }, { country: "GB" }],
                partnerKinds: ["importer", "distributor", "retailer"],
                constraints: null,
                knownPartnerDomains: [knownPartner.domain],
            },
        });

        const ports = createFixturePorts({
            category: "specialty coffee",
            world,
            publishDossier: async input => {
                published.push(input);
                return { documentId: 1000 + published.length };
            },
            debitCredits: async ({ amount }) => {
                debits.push(amount);
            },
        });
        ports.creditsPerCandidate = 7;

        const run = await createRun({
            companyId,
            programId: program.id,
            userId: "user-1",
            options: { maxCandidates: 10, mode: "fixture" },
        });
        const summary = await runDistributionPipeline(
            { runId: run.id, companyId, programId: program.id },
            ports
        );

        // The run finished and says what happened.
        const finished = (await getRun(run.id, companyId))!;
        expect(finished.status).toBe("completed");
        expect(summary.sources.find(s => s.source === "web")!.status).toBe("ok");
        expect(summary.sources.find(s => s.source === "trade")!.status).toBe("ok");
        expect(summary.sources.find(s => s.source === "place")!.status).toBe("skipped");
        expect(summary.shortlisted).toBeGreaterThanOrEqual(4);
        expect(summary.enriched).toBe(summary.shortlisted);
        expect(summary.gateRejections).toBe(0);
        expect(summary.published).toBe(summary.shortlisted);
        expect(summary.screened).toBe(summary.shortlisted);
        expect(summary.flagged).toBe(1);

        // Every shortlisted candidate is researched with a score, evidence and a dossier.
        const partners = await listPartners(companyId, { programId: program.id });
        expect(partners).toHaveLength(summary.shortlisted);
        for (const item of partners) {
            expect(item.relationship.stage).toBe("researched");
            expect(item.relationship.fitScore).not.toBeNull();
            expect(item.relationship.dossier).not.toBeNull();
            expect(item.relationship.dossierDocumentId).toBeGreaterThan(1000);
            expect(item.evidenceCount).toBeGreaterThan(0);
            const events = await listEvents(companyId, item.relationship.id);
            expect(events.some(e => e.type === "researched")).toBe(true);
        }
        // Only countries in the program were gathered, each organisation with its own
        // country (not the first query's); the known partner never appeared.
        expect(partners.every(p => ["DE", "NL", "GB"].includes(p.org.country ?? ""))).toBe(true);
        expect(partners.find(p => p.org.domain === "dutch-delights.example")!.org.country).toBe(
            "NL"
        );
        expect(partners.find(p => p.org.domain === "shady-trading.example")!.org.country).toBe(
            "GB"
        );
        expect(partners.find(p => p.org.domain === knownPartner.domain)).toBeUndefined();
        // The flagged organisation carries an advisory screen, not a block.
        const shady = partners.find(p => p.org.domain === "shady-trading.example")!;
        expect(shady.relationship.screening?.status).toBe("flagged");
        expect(shady.relationship.riskFlags.some(f => f.includes("screening"))).toBe(true);
        // A well-documented importer in a target country outscores the thin retailer.
        const nordwind = partners.find(p => p.org.domain === "nordwind-import.example")!;
        const thin = partners.find(p => p.org.domain === "canal-concept-stores.example")!;
        expect(nordwind.relationship.fitScore!).toBeGreaterThan(thin.relationship.fitScore!);
        // Evidence quotes are verbatim from the fixture pages.
        const evidence = await listEvidenceForOrg(companyId, nordwind.org.id);
        expect(evidence.some(e => e.quote?.startsWith("We carry Beta Roasters"))).toBe(true);
        // Metering ran once per completed candidate, after the work.
        expect(debits).toHaveLength(summary.shortlisted);
        expect(debits.every(d => d === 7)).toBe(true);
        expect(finished.creditsUsed).toBe(7 * summary.shortlisted);

        // Dashboard reflects it.
        const dashboard = await getDashboard(companyId, program.id);
        expect(dashboard.counts.researched).toBe(summary.shortlisted);
        expect(dashboard.targetedCells).toBe(9);
        expect(dashboard.coveredCells).toBe(0);

        // A second run over the same world creates no new organisations or relationships.
        const run2 = await createRun({
            companyId,
            programId: program.id,
            userId: "user-1",
            options: { maxCandidates: 10, mode: "fixture" },
        });
        const summary2 = await runDistributionPipeline(
            { runId: run2.id, companyId, programId: program.id },
            ports
        );
        const partnersAfter = await listPartners(companyId, { programId: program.id });
        expect(partnersAfter.map(p => p.relationship.id).sort()).toEqual(
            partners.map(p => p.relationship.id).sort()
        );
        expect(summary2.resolved).toBe(summary.resolved);
    }, 120_000);
});
