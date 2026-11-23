import { configureSecretBox, encryptSecret } from "@launchstack/store/crypto";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

it.each([
    ["vantage-admission/v1", "baseline"],
    ["vantage-admission/v2", "baseline"],
    ["vantage-admission/v2", "role"],
    ["vantage-admission/v2", "internal-research"],
    ["vantage-admission/v3", "combined"],
])(
    "opens, restores and decides saved %s / %s across topic flag toggles",
    async (schemaVersion, mode) => {
        configureSecretBox({ key: Buffer.alloc(32, 42).toString("base64") });
        const actor = { companyId: "1", userId: "historical-owner" };
        const id = "00000000-0000-4000-8000-000000000001";
        const payload = {
            schema: "vantage-weekly-review/v2.1",
            id,
            companyId: "1",
            ownerId: actor.userId,
            report: { topics: [{ id: "topic-0", title: "Saved decision" }] },
            evidence: { schemaVersion, selectionDiagnostics: { dynamicRetrieval: { mode } } },
        };
        const row = {
            id,
            status: "accepted",
            retrieval_mode: "legacy",
            week_start: "2026-11-16",
            review_version: 1,
            schema_version: payload.schema,
            dependencies: [],
            ciphertext: encryptSecret(
                JSON.stringify(payload),
                "vantage-report:1:" + actor.userId + ":" + id
            ).ciphertext,
        };
        let active: string | null = null;
        const decisions: { ciphertext: unknown }[] = [];
        const query: WeeklyReviewQuery = async (text, parameters = []) => {
            if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs")) return [row];
            if (text.startsWith("SELECT run_id FROM")) return active ? [{ run_id: active }] : [];
            if (text.startsWith("SELECT ciphertext FROM")) return decisions;
            if (text.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_active"))
                active = String(parameters[3]);
            if (text.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_decisions"))
                decisions.push({ ciphertext: parameters[6] });
            if (text.startsWith("UPDATE pdr_ai_v2_vantage_weekly_review_runs SET review_version"))
                row.review_version = Number(parameters[1]);
            return [];
        };
        const authority = jest.fn(async () => undefined);
        const repository = createWeeklyReviewRepository(
            { transaction: work => work(query) },
            authority
        );
        const previousFlag = process.env.VANTAGE_TOPIC_FIRST_ENABLED;
        try {
            for (const flag of ["false", "true"]) {
                process.env.VANTAGE_TOPIC_FIRST_ENABLED = flag;
                expect((await repository.get(actor, id)).report.topics[0]?.id).toBe("topic-0");
                expect(
                    (
                        await repository.restore(actor, id, {
                            expectedActiveId: active,
                            key: "restore-" + flag,
                        })
                    ).runId
                ).toBe(id);
                const version = row.review_version;
                expect(
                    await repository.decide(actor, id, {
                        key: "decision-" + flag,
                        expectedVersion: version,
                        topicId: "topic-0",
                        decision: "Proceed",
                    })
                ).toBe(version + 1);
                const reloaded = await repository.get(actor, id);
                expect(reloaded.version).toBe(version + 1);
                expect(reloaded.decisions).toHaveLength(flag === "true" ? 2 : 1);
            }
            expect(authority.mock.calls).toHaveLength(8);
        } finally {
            if (previousFlag === undefined) delete process.env.VANTAGE_TOPIC_FIRST_ENABLED;
            else process.env.VANTAGE_TOPIC_FIRST_ENABLED = previousFlag;
        }
    }
);
