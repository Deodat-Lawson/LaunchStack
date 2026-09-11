/**
 * Distribution persistence against a real database with the full migration
 * history applied (which also proves 20260904023742_distribution_pipeline
 * applies cleanly). Gated like the other integration suites.
 *
 * Covers the design's stated checks (§8): two runs over the same mentions
 * create no duplicate organisations; company B cannot read company A's
 * partners; import creates active relationships and exclusions; the stage
 * machine writes events; dashboard aggregates match a hand-computed fixture.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import { resolveOrganizations } from "@launchstack/tools/org-resolver";
import {
    addEvent,
    createAgreement,
    createProgram,
    createRun,
    getDashboard,
    getRelationship,
    importPartners,
    insertEvidence,
    listEvents,
    listExclusions,
    listPartners,
    setResearchResult,
    transitionStage,
    updateRun,
    upsertCandidateRelationships,
    upsertOrgs,
} from "@launchstack/pipelines/distribution/db";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const mentions = [
    {
        name: "Acme Import GmbH",
        url: "https://www.acme-import.de/brands",
        country: "DE",
        roles: ["importer"],
        source: "web",
    },
    {
        name: "ACME IMPORT",
        url: "https://acme-import.de/",
        country: "Germany",
        roles: ["distributor"],
        source: "web",
    },
    {
        name: "Dutch Delights B.V.",
        url: "https://dutchdelights.nl",
        country: "NL",
        roles: ["distributor"],
        source: "web",
    },
    {
        name: "Existing Importer",
        url: "https://existing-importer.de",
        country: "DE",
        roles: ["importer"],
        source: "web",
    },
];

describeDb("distribution persistence", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyA: bigint;
    let companyB: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const rows = await testDb.db
            .insert(company)
            .values([
                { name: "Seller A", numberOfEmployees: "5" },
                { name: "Seller B", numberOfEmployees: "5" },
            ])
            .returning();
        companyA = BigInt(rows[0]!.id);
        companyB = BigInt(rows[1]!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    async function makeProgram(companyId: bigint) {
        return createProgram({
            companyId,
            userId: "user-1",
            input: {
                name: "EU coffee",
                offering: "Roasted specialty coffee",
                categories: ["coffee"],
                hsCodes: ["0901"],
                targetTerritories: [{ country: "DE" }, { country: "NL" }],
                partnerKinds: ["importer", "distributor"],
                constraints: null,
                knownPartnerDomains: ["existing-importer.de"],
            },
        });
    }

    it("resolves once per company: a second run upserts instead of duplicating, and exclusions hold", async () => {
        const program = await makeProgram(companyA);
        const run1 = await createRun({
            companyId: companyA,
            programId: program.id,
            userId: "user-1",
            options: { maxCandidates: 10 },
        });
        const exclusions = await listExclusions(companyA, program.id);
        expect(exclusions.domains).toContain("existing-importer.de");

        const resolved = resolveOrganizations(mentions, {
            excludeDomains: exclusions.domains,
            excludeKeys: exclusions.keys,
        });
        expect(resolved.map(o => o.name).sort()).toEqual([
            "Acme Import GmbH",
            "Dutch Delights B.V.",
        ]);

        const first = await upsertOrgs({ companyId: companyA, runId: run1.id, orgs: resolved });
        expect(first).toHaveLength(2);
        expect(first.find(o => o.domain === "acme-import.de")!.roles.sort()).toEqual([
            "distributor",
            "importer",
        ]);

        const run2 = await createRun({
            companyId: companyA,
            programId: program.id,
            userId: "user-1",
            options: { maxCandidates: 10 },
        });
        const second = await upsertOrgs({ companyId: companyA, runId: run2.id, orgs: resolved });
        expect(second.map(o => o.id).sort()).toEqual(first.map(o => o.id).sort());

        const relationships = await upsertCandidateRelationships({
            companyId: companyA,
            programId: program.id,
            items: first.map(o => ({
                orgId: o.id,
                kind: "importer" as const,
                territory: { country: o.country ?? "DE" },
            })),
        });
        expect(relationships).toHaveLength(2);
        // Re-running the candidate upsert does not reset anything.
        const again = await upsertCandidateRelationships({
            companyId: companyA,
            programId: program.id,
            items: first.map(o => ({ orgId: o.id, kind: "importer" as const, territory: null })),
        });
        expect(again.map(r => r.id).sort()).toEqual(relationships.map(r => r.id).sort());

        // Company B sees nothing of company A.
        const forB = await listPartners(companyB, { programId: program.id });
        expect(forB).toHaveLength(0);
        expect(await getRelationship(relationships[0]!.id, companyB)).toBeNull();
        await updateRun(run1.id, companyA, { status: "completed" });
    });

    it("runs the stage machine with events, enforces required fields, and reports the dashboard", async () => {
        const program = await makeProgram(companyA);
        const [org] = await upsertOrgs({
            companyId: companyA,
            runId: null,
            orgs: resolveOrganizations([
                {
                    name: "Berlin Kaffee Vertrieb",
                    url: "https://berlin-kaffee.de",
                    country: "DE",
                    roles: ["distributor"],
                },
            ]),
        });
        const [rel] = await upsertCandidateRelationships({
            companyId: companyA,
            programId: program.id,
            items: [{ orgId: org!.id, kind: "distributor", territory: { country: "DE" } }],
        });
        const evidence = await insertEvidence({
            companyId: companyA,
            orgId: org!.id,
            runId: null,
            kind: "brands_carried",
            claim: "Carries Beta",
            sourceUrl: "https://berlin-kaffee.de/marken",
            quote: "Beta",
        });
        expect(evidence.id).toBeGreaterThan(0);
        await setResearchResult(rel!.id, companyA, {
            dossier: null,
            fitScore: 64,
            fitRationale: "ok",
            fitBreakdown: {
                categoryOverlap: 20,
                territoryMatch: 20,
                roleMatch: 10,
                evidenceDepth: 4,
                freshness: 5,
                sizeFit: 3,
                knownSignal: 0,
                total: 64,
            },
            riskFlags: [],
            screening: { status: "not_run" },
            stage: "researched",
        });

        await expect(
            transitionStage({
                companyId: companyA,
                relationshipId: rel!.id,
                to: "contacted",
                actorUserId: "user-1",
            })
        ).rejects.toMatchObject({ code: "owner_required", status: 409 });
        await transitionStage({
            companyId: companyA,
            relationshipId: rel!.id,
            to: "contacted",
            actorUserId: "user-1",
            ownerUserId: "user-1",
        });
        await transitionStage({
            companyId: companyA,
            relationshipId: rel!.id,
            to: "in_conversation",
            actorUserId: "user-1",
            nextAction: "Send samples",
            nextActionAt: new Date(Date.now() + 2 * 86_400_000),
        });
        await transitionStage({
            companyId: companyA,
            relationshipId: rel!.id,
            to: "qualified",
            actorUserId: "user-1",
        });
        await transitionStage({
            companyId: companyA,
            relationshipId: rel!.id,
            to: "negotiating",
            actorUserId: "user-1",
        });
        await expect(
            transitionStage({
                companyId: companyA,
                relationshipId: rel!.id,
                to: "contracted",
                actorUserId: "user-1",
            })
        ).rejects.toMatchObject({ code: "agreement_required" });
        await createAgreement({
            companyId: companyA,
            relationshipId: rel!.id,
            input: {
                exclusivity: "exclusive",
                territory: [{ country: "DE" }],
                terms: {},
                startsOn: "2026-10-01",
                endsOn: "2027-09-30",
                renewalReminderAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
        });
        await transitionStage({
            companyId: companyA,
            relationshipId: rel!.id,
            to: "contracted",
            actorUserId: "user-1",
        });
        await addEvent({
            companyId: companyA,
            relationshipId: rel!.id,
            type: "note",
            payload: { text: "Signed." },
            actorUserId: "user-1",
        });

        const events = await listEvents(companyA, rel!.id);
        const stageChanges = events.filter(e => e.type === "stage_changed").map(e => e.payload.to);
        expect(stageChanges.reverse()).toEqual([
            "contacted",
            "in_conversation",
            "qualified",
            "negotiating",
            "contracted",
        ]);

        const dashboard = await getDashboard(companyA, program.id);
        expect(dashboard.counts.contracted).toBe(1);
        expect(
            dashboard.coverage.find(c => c.country === "DE" && c.kind === "distributor")!.covered
        ).toBe(1);
        expect(
            dashboard.coverage.find(c => c.country === "NL" && c.kind === "importer")!.covered
        ).toBe(0);
        expect(dashboard.targetedCells).toBe(4);
        expect(dashboard.coveredCells).toBe(1);
        expect(dashboard.renewalsDue).toBe(1);
        expect(dashboard.funnel.find(f => f.stage === "contacted")!.count).toBeGreaterThanOrEqual(
            1
        );
    });

    it("imports existing partners as active and adds their domains to the exclusions", async () => {
        const program = await makeProgram(companyA);
        const result = await importPartners({
            companyId: companyA,
            programId: program.id,
            userId: "user-1",
            rows: [
                {
                    name: "Nordic Foods AS",
                    domain: "nordicfoods.no",
                    country: "NO",
                    kind: "distributor",
                    stage: "active",
                    territoryCountry: "NO",
                    ownerUserId: null,
                },
                {
                    name: "Nordic Foods AS",
                    domain: "www.nordicfoods.no",
                    country: "NO",
                    kind: "distributor",
                    stage: "active",
                    territoryCountry: null,
                    ownerUserId: null,
                },
            ],
        });
        expect(result.created).toBe(1);
        expect(result.existing).toBe(1);
        const exclusions = await listExclusions(companyA, program.id);
        expect(exclusions.domains).toEqual(
            expect.arrayContaining(["existing-importer.de", "nordicfoods.no"])
        );
        const partners = await listPartners(companyA, { programId: program.id });
        expect(partners).toHaveLength(1);
        expect(partners[0]!.relationship.stage).toBe("active");
        expect(partners[0]!.relationship.source).toBe("import");
        // Discovery over a mention of the same partner resolves to nothing.
        expect(
            resolveOrganizations([{ name: "Nordic Foods", url: "https://nordicfoods.no/brands" }], {
                excludeDomains: exclusions.domains,
                excludeKeys: exclusions.keys,
            })
        ).toEqual([]);
    });
});
