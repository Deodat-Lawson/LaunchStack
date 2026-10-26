/**
 * The sales pipeline stored in its own words, against a real database.
 *
 * 1. The migration: deals and stage events written in the retired partner
 *    vocabulary come out in the funnel's words, each deal shows exactly what
 *    the screens showed before, and the stage history is seeded from the
 *    events with one open stint per deal.
 * 2. After it: a deal moves into Proposal (which had no stored stage and
 *    failed), every move writes the history in the same transaction, and
 *    stageDurations answers "how long do deals sit here?" — counting the
 *    deals sitting there now, which the event pairing never did.
 *
 * Gated like the other integration suites.
 */
import { sql } from "drizzle-orm";

import { configureDatabase } from "@launchstack/store/client";
import {
    getDashboard,
    getRelationship,
    stageDurations,
    transitionStage,
    upsertCandidateRelationships,
} from "@launchstack/pipelines/distribution/db";
import { StageTransitionError } from "@launchstack/pipelines/distribution/stages";
import { LEGACY_STAGE_MAP } from "@launchstack/pipelines/distribution/types";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

const MIGRATION = "20261026232205_deal_stage_history";
const DAY = 86_400_000;

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Row = Record<string, unknown>;

describeDb("deal stages in the funnel's words", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const programId = "prog-1";
    const t0 = new Date(Date.now() - 30 * DAY);
    const at = (days: number) => new Date(t0.getTime() + days * DAY).toISOString();

    const rows = async (query: ReturnType<typeof sql>) =>
        (await testDb.db.execute(query)) as unknown as Row[];

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase({ holdBack: [MIGRATION] });
        configureDatabase(testDb.db);

        const [c] = await rows(
            sql`insert into pdr_ai_v2_company (name, "numberOfEmployees") values ('Roastery', '5') returning id`
        );
        companyId = BigInt(c!.id as number);
        await testDb.db.execute(sql`
            insert into pdr_ai_v2_distribution_programs (id, company_id, created_by_user_id, name, offering)
            values (${programId}, ${companyId}, 'u1', 'Cafés', 'Coffee beans')`);

        // One org per legacy stage, plus a deal with a history of moves.
        const legacy = Object.keys(LEGACY_STAGE_MAP);
        for (const stage of [...legacy, "history"]) {
            await testDb.db.execute(sql`
                insert into pdr_ai_v2_partner_orgs (id, company_id, resolve_key, name)
                values (${`org-${stage}`}, ${companyId}, ${`key-${stage}`}, ${`Org ${stage}`})`);
        }
        for (const stage of legacy) {
            await testDb.db.execute(sql`
                insert into pdr_ai_v2_partner_relationships
                    (id, company_id, program_id, org_id, kind, stage, owner_user_id, created_at, stage_changed_at)
                values (${`rel-${stage}`}, ${companyId}, ${programId}, ${`org-${stage}`}, 'retailer',
                    ${stage}, 'u1', ${at(0)}, ${at(0)})`);
        }
        // candidate (day 0) → contacted (day 2) → in_conversation (day 9), still there.
        await testDb.db.execute(sql`
            insert into pdr_ai_v2_partner_relationships
                (id, company_id, program_id, org_id, kind, stage, owner_user_id, next_action, created_at, stage_changed_at)
            values ('rel-history', ${companyId}, ${programId}, 'org-history', 'retailer',
                'in_conversation', 'u1', 'Send the price list', ${at(0)}, ${at(9)})`);
        for (const [from, to, day] of [
            ["candidate", "contacted", 2],
            ["contacted", "in_conversation", 9],
        ] as const) {
            await testDb.db.execute(sql`
                insert into pdr_ai_v2_relationship_events
                    (company_id, relationship_id, type, payload, actor_user_id, occurred_at)
                values (${companyId}, 'rel-history', 'stage_changed',
                    ${JSON.stringify({ from, to })}::jsonb, 'u1', ${at(day)})`);
        }

        await testDb.applyMigration(MIGRATION);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    it("rewrites every legacy stage to what the screens already showed", async () => {
        for (const [legacy, now] of Object.entries(LEGACY_STAGE_MAP)) {
            const rel = await getRelationship(`rel-${legacy}`, companyId);
            expect([legacy, rel?.stage]).toEqual([legacy, now]);
        }
        expect((await getRelationship("rel-history", companyId))?.stage).toBe("meeting");
    });

    it("rewrites the stage events into the same words", async () => {
        const events = await rows(sql`
            select payload from pdr_ai_v2_relationship_events
            where relationship_id = 'rel-history' order by occurred_at`);
        expect(events.map(e => e.payload)).toEqual([
            { from: "lead", to: "contacted" },
            { from: "contacted", to: "meeting" },
        ]);
    });

    it("seeds the history from the events, with exactly one open stint per deal", async () => {
        const stints = await rows(sql`
            select stage, entered_at, exited_at from pdr_ai_v2_deal_stage_history
            where relationship_id = 'rel-history' order by entered_at`);
        expect(stints.map(s => [s.stage, s.exited_at === null])).toEqual([
            ["lead", false],
            ["contacted", false],
            ["meeting", true],
        ]);
        const [open] = await rows(sql`
            select count(*)::int as deals, count(*) filter (where exited_at is null)::int as open
            from pdr_ai_v2_deal_stage_history h
            where h.company_id = ${companyId}
              and h.relationship_id in (select id from pdr_ai_v2_partner_relationships)`);
        const [deals] = await rows(
            sql`select count(*)::int as n from pdr_ai_v2_partner_relationships`
        );
        expect(open!.open).toBe(deals!.n);
    });

    it("moves a deal into Proposal, which used to fail with 'Not a stage in this workspace yet'", async () => {
        const moved = await transitionStage({
            companyId,
            relationshipId: "rel-history",
            to: "proposal",
            actorUserId: "u1",
        });
        expect(moved.stage).toBe("proposal");
        const stints = await rows(sql`
            select stage, exited_at from pdr_ai_v2_deal_stage_history
            where relationship_id = 'rel-history' order by entered_at`);
        expect(stints.map(s => [s.stage, s.exited_at === null])).toEqual([
            ["lead", false],
            ["contacted", false],
            ["meeting", false],
            ["proposal", true],
        ]);
    });

    it("still refuses skipped steps and missing fields, and writes nothing when it does", async () => {
        // A company discovery just found: a lead nobody owns yet.
        await testDb.db.execute(sql`
            insert into pdr_ai_v2_partner_orgs (id, company_id, resolve_key, name)
            values ('org-new', ${companyId}, 'key-new', 'New Org')`);
        const [fresh] = await upsertCandidateRelationships({
            companyId,
            programId,
            items: [{ orgId: "org-new", kind: "distributor", territory: null }],
        });
        expect(fresh!.stage).toBe("lead");
        await expect(
            transitionStage({
                companyId,
                relationshipId: fresh!.id,
                to: "negotiating",
                actorUserId: "u1",
            })
        ).rejects.toBeInstanceOf(StageTransitionError);
        await expect(
            transitionStage({
                companyId,
                relationshipId: fresh!.id,
                to: "contacted",
                actorUserId: "u1",
            })
        ).rejects.toMatchObject({ code: "owner_required" });
        const stints = await rows(sql`
            select stage, exited_at from pdr_ai_v2_deal_stage_history
            where relationship_id = ${fresh!.id}`);
        // New deals open their first stint when they are created.
        expect(stints.map(s => [s.stage, s.exited_at === null])).toEqual([["lead", true]]);
    });

    it("answers how long deals sit in each stage, including the ones there now", async () => {
        const durations = await stageDurations(companyId, programId);
        // rel-history spent 2 days as a lead and 7 days contacted; the legacy
        // "contacted" deal is still there.
        expect(durations.contacted).toMatchObject({ medianDays: 7, completed: 1, open: 1 });
        expect(durations.lead?.completed).toBeGreaterThanOrEqual(1);
        // Proposal: one deal there right now and none finished yet — still visible.
        expect(durations.proposal).toMatchObject({ medianDays: null, completed: 0, open: 1 });
        expect(durations.proposal?.openMedianDays).not.toBeNull();
        // The won deals (legacy contracted + active) have sat there ~30 days.
        expect(durations.won?.open).toBe(2);
        expect(durations.won?.openMedianDays).toBeGreaterThanOrEqual(29);

        const dashboard = await getDashboard(companyId, programId);
        expect(dashboard.medianDaysInStage.contacted).toBe(7);
        expect(dashboard.counts.proposal).toBe(1);
        expect(dashboard.funnel.map(f => f.stage)).toContain("proposal");
    });
});
