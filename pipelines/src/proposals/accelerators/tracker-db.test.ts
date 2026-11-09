import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@launchstack/store/client", () => ({ getDb: mocks.getDb }));

import {
    createTrackerTask,
    getTrackerOpportunity,
    saveTrackerOpportunity,
    updateTrackerOpportunity,
    updateTrackerTask,
} from "./tracker-db";

const id = "88888888-8888-4888-8888-888888888888";
const createdAt = new Date("2026-11-07T00:00:00Z");
const originalDeadline = new Date("2026-12-01T18:00:00Z");
const saved = {
    id,
    companyId: 9n,
    programId: "program",
    cycleId: null as string | null,
    priority: "high",
    status: "rejected",
    notes: "Keep private notes",
    submittedOn: "2026-11-01",
    nextAction: "Review",
    plannedDeadline: originalDeadline,
    createdAt,
    updatedAt: createdAt,
};
let results: unknown[][];
let writes: { kind: string; values: Record<string, unknown>; where?: unknown }[];
let conditions: unknown[];
let executor: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    results = [];
    writes = [];
    conditions = [];
    const query = () => {
        const chain = {
            from: () => chain,
            where: (condition: unknown) => {
                conditions.push(condition);
                return chain;
            },
            orderBy: () => chain,
            limit: () => chain,
            for: () => chain,
            then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(results.shift() ?? []).then(resolve),
        };
        return chain;
    };
    const write = (kind: string) => {
        const entry = { kind, values: {} as Record<string, unknown>, where: undefined as unknown };
        writes.push(entry);
        const chain = {
            values: (values: Record<string, unknown>) => {
                entry.values = values;
                return chain;
            },
            set: (values: Record<string, unknown>) => {
                entry.values = values;
                return chain;
            },
            where: (where: unknown) => {
                entry.where = where;
                return chain;
            },
            returning: () => chain,
            then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(results.shift() ?? []).then(resolve),
        };
        return chain;
    };
    executor = {
        select: vi.fn(query),
        insert: vi.fn(() => write("insert")),
        update: vi.fn(() => write("update")),
        execute: vi.fn(async () => undefined),
        transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(executor)),
    };
    mocks.getDb.mockReturnValue(executor);
});

describe("tracker storage invariants", () => {
    it("upgrades in place, preserving notes, outcome, tasks and a previously planned deadline", async () => {
        const child = {
            id: "task",
            companyId: 9n,
            opportunityId: id,
            title: "Follow up",
            dueOn: null,
            priority: "high",
            done: false,
            completedAt: null,
            createdAt,
            updatedAt: createdAt,
        };
        results.push([saved], [], [{ ...saved, cycleId: "spring" }], [child]);
        const result = await saveTrackerOpportunity(
            9n,
            { programId: "program", cycleId: "spring" },
            "2027-01-01T00:00:00Z"
        );
        expect(result).toMatchObject({
            id,
            cycleId: "spring",
            notes: saved.notes,
            status: "rejected",
            plannedDeadline: originalDeadline.toISOString(),
            tasks: [{ id: "task" }],
        });
        expect(executor.insert).not.toHaveBeenCalled();
        expect(writes).toEqual([
            {
                kind: "update",
                values: {
                    cycleId: "spring",
                    plannedDeadline: originalDeadline,
                    updatedAt: expect.any(Date),
                },
                where: expect.anything(),
            },
        ]);
        expect(executor.execute).toHaveBeenCalledOnce();
    });

    it("is idempotent for the same cycle without resetting any private fields", async () => {
        const existing = { ...saved, cycleId: "spring" };
        results.push([existing], [existing], []);
        const result = await saveTrackerOpportunity(
            9n,
            { programId: "program", cycleId: "spring" },
            "2028-01-01T00:00:00Z"
        );
        expect(result.id).toBe(id);
        expect(result.plannedDeadline).toBe(originalDeadline.toISOString());
        expect(writes).toEqual([]);
    });

    it("creates a separate later cycle rather than overwriting an earlier outcome", async () => {
        const laterId = "99999999-9999-4999-8999-999999999999";
        results.push(
            [{ ...saved, cycleId: "spring" }],
            [{ id: laterId }],
            [{ ...saved, id: laterId, cycleId: "fall", status: "shortlisted" }],
            []
        );
        const result = await saveTrackerOpportunity(
            9n,
            { programId: "program", cycleId: "fall" },
            null
        );
        expect(result).toMatchObject({ id: laterId, cycleId: "fall", status: "shortlisted" });
        expect(executor.update).not.toHaveBeenCalled();
        expect(writes[0]).toMatchObject({
            kind: "insert",
            values: { companyId: 9n, programId: "program", cycleId: "fall", plannedDeadline: null },
        });
    });

    it("keeps catalogue changes out of an unrelated edit", async () => {
        results.push([saved], [], [saved], [], [{ ...saved, notes: "Updated" }], []);
        const result = await updateTrackerOpportunity(
            9n,
            id,
            { notes: "Updated" },
            "2029-01-01T00:00:00Z"
        );
        expect(result.notes).toBe("Updated");
        expect(writes[0]?.values).toMatchObject({
            plannedDeadline: originalDeadline,
            notes: "Updated",
        });
    });

    it("returns no opportunity across company boundaries and filters SQL by session company", async () => {
        results.push([]);
        expect(await getTrackerOpportunity(10n, id)).toBeNull();
        const sql = new PgDialect().sqlToQuery(
            conditions[0] as Parameters<PgDialect["sqlToQuery"]>[0]
        );
        expect(sql.sql).toContain('"company_id"');
        expect(sql.params).toEqual([10n, id]);
    });

    it("does not create tasks for a missing or other-company opportunity", async () => {
        results.push([]);
        await expect(createTrackerTask(10n, id, { title: "Wrong company" })).rejects.toMatchObject({
            status: 404,
        });
        expect(executor.insert).not.toHaveBeenCalled();
        const sql = new PgDialect().sqlToQuery(
            conditions[0] as Parameters<PgDialect["sqlToQuery"]>[0]
        );
        expect(sql.params).toEqual([10n, id]);
    });

    it("scopes task updates to company, opportunity and task together", async () => {
        results.push([]);
        await expect(updateTrackerTask(10n, id, "task", { done: true })).rejects.toMatchObject({
            status: 404,
        });
        expect(executor.update).not.toHaveBeenCalled();
        const sql = new PgDialect().sqlToQuery(
            conditions[0] as Parameters<PgDialect["sqlToQuery"]>[0]
        );
        expect(sql.params).toEqual([10n, id, "task"]);
    });
});
