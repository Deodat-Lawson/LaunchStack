import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureDatabase, createDb } from "@launchstack/store/client";
import {
    createCommitment,
    reorderTopics,
    deleteTopic,
    deleteCommitment,
    recordDecision,
    updateTopic,
    updateCommitment,
    undoDecision,
} from "./db";
const url = process.env.VANTAGE_PRODUCTION_PG_URL;
const allowed =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance";
if (url && url !== allowed) throw new Error("Refusing a non-owned acceptance database");
const suite = url ? describe : describe.skip;
suite("native action integrity against isolated PostgreSQL", () => {
    const store = createDb({ url: allowed });
    const actor = "native-integrity-test";
    const agenda = randomUUID(),
        topic = randomUUID();
    let companyId: bigint;
    beforeAll(async () => {
        configureDatabase(store.db);
        const [ready] =
            await store.client`SELECT to_regclass('pdr_ai_v2_vantage_decision_operations') AS receipt, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='pdr_ai_v2_vantage_commitments' AND column_name='content_version') AS version`;
        if (!ready!.receipt || !ready!.version)
            throw new Error(
                "Apply the native action integrity migration before this acceptance test"
            );
        const rows =
            await store.client`INSERT INTO pdr_ai_v2_company(name, "numberOfEmployees") VALUES ('Native integrity synthetic', '1') RETURNING id`;
        companyId = BigInt(rows[0]!.id);
        await store.client`INSERT INTO pdr_ai_v2_vantage_agendas(id, company_id, created_by_user_id, week_start) VALUES (${agenda}, ${companyId.toString()}, ${actor}, '2026-11-09')`;
        await store.client`INSERT INTO pdr_ai_v2_vantage_agenda_topics(id, agenda_id, company_id, origin, title) VALUES (${topic}, ${agenda}, ${companyId.toString()}, 'ai', 'Synthetic topic')`;
    });
    afterAll(async () => {
        if (companyId) {
            await store.client`DELETE FROM pdr_ai_v2_vantage_decision_operations WHERE company_id=${companyId.toString()}`;
            await store.client`DELETE FROM pdr_ai_v2_company WHERE id=${companyId.toString()}`;
        }
        await store.close();
    });
    it("serializes decisions, replays exact receipts, rejects stale edits and preserves explicit outcomes", async () => {
        const input = {
            companyId,
            userId: actor,
            topicId: topic,
            expectedContentVersion: 1,
            idempotencyKey: randomUUID(),
            decision: "Run a bounded trial",
            commitment: {
                title: "Trial",
                owner: "Human",
                dueOn: "2026-11-20",
                test: "Three complete the task",
            },
        };
        const [first, replay] = await Promise.all([recordDecision(input), recordDecision(input)]);
        expect(replay).toEqual(first);
        const count =
            await store.client`SELECT count(*)::int AS count FROM pdr_ai_v2_vantage_commitments WHERE topic_id=${topic}`;
        expect(count[0]!.count).toBe(1);
        await expect(recordDecision({ ...input, decision: "Different" })).rejects.toMatchObject({
            code: "idempotency_conflict",
        });
        await expect(
            updateTopic({
                companyId,
                id: topic,
                patch: { expectedContentVersion: 1, status: "dismissed" },
            })
        ).rejects.toMatchObject({ code: "stale_topic" });
        const kept = await updateTopic({
            companyId,
            id: topic,
            patch: { expectedContentVersion: first.contentVersion, status: "kept" },
        });
        const undone = await updateTopic({
            companyId,
            id: topic,
            patch: { expectedContentVersion: kept.contentVersion, status: "suggested" },
        });
        expect(undone.contentVersion).toBe(kept.contentVersion + 1);
        await expect(
            updateCommitment({
                companyId,
                id: first.commitmentId!,
                patch: { expectedContentVersion: 1, status: "done" },
            })
        ).rejects.toMatchObject({ code: "outcome_required" });
        const resolved = await updateCommitment({
            companyId,
            id: first.commitmentId!,
            patch: {
                expectedContentVersion: 1,
                status: "done",
                outcome: "Two completed; hypothesis not met",
            },
        });
        expect(resolved.contentVersion).toBe(2);
        await expect(
            updateCommitment({
                companyId,
                id: first.commitmentId!,
                patch: { expectedContentVersion: 1, status: "done", outcome: "Stale" },
            })
        ).rejects.toMatchObject({ code: "stale_commitment" });
        await expect(
            undoDecision({
                companyId,
                topicId: topic,
                commitmentId: first.commitmentId,
                expectedContentVersion: 1,
            })
        ).rejects.toMatchObject({ code: "archive_required" });
        await expect(deleteTopic({ companyId, id: topic })).rejects.toMatchObject({
            code: "archive_required",
        });
        await expect(
            deleteCommitment({ companyId, id: first.commitmentId! })
        ).rejects.toMatchObject({ code: "archive_required" });
        await expect(
            reorderTopics({
                companyId,
                agendaId: agenda,
                ids: [topic],
                expectedVersions: { [topic]: 1 },
            })
        ).rejects.toMatchObject({ code: "stale_topic" });
        await reorderTopics({
            companyId,
            agendaId: agenda,
            ids: [topic],
            expectedVersions: { [topic]: undone.contentVersion },
        });
        const standalone = {
            companyId,
            userId: actor,
            idempotencyKey: randomUUID(),
            input: {
                title: "Independent action",
                owner: "Human",
                dueOn: "2026-11-21",
                test: "A human supplies acceptance",
            },
        };
        const [left, right] = await Promise.all([
            createCommitment(standalone),
            createCommitment(standalone),
        ]);
        expect(right).toEqual(left);
        await expect(
            createCommitment({
                ...standalone,
                input: { ...standalone.input, title: "Conflicting payload" },
            })
        ).rejects.toMatchObject({ code: "idempotency_conflict" });
    });
});
