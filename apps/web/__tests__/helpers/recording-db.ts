/**
 * `fakeDb`, plus a record of every `where` it was given, rendered through the
 * real Postgres dialect — for tests whose point is *which rows* a query asks
 * for ("only the caller's inbox", "only grants this person added"), which the
 * plain fake cannot see because it never interprets predicates.
 *
 *   jest.mock("~/server/db", () => ({
 *       db: jest.requireActual("../../helpers/recording-db").recordingDb.db,
 *   }));
 *
 * Results still come from `fakeDb.onSelect` / `onReturning`; call
 * `recordingDb.reset()` (which also resets `fakeDb`) in `beforeEach`.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { fakeDb } from "./fake-db";

type Op = "select" | "update" | "delete";

interface Recorded {
    op: Op;
    table: object | undefined;
    where: SQL | undefined;
}

const dialect = new PgDialect();

class RecordingDb {
    readonly recorded: Recorded[] = [];

    reset(): void {
        this.recorded.length = 0;
        fakeDb.reset();
    }

    /** Every `where` on `table` for `op`, as `{ sql, params }`, in call order. */
    wheres(table: object, op: Op = "select"): { sql: string; params: unknown[] }[] {
        return this.recorded
            .filter(r => r.table === table && r.op === op)
            .map(r => (r.where ? dialect.sqlToQuery(r.where) : { sql: "", params: [] }));
    }

    private wrap<T extends object>(builder: T, op: Op, initialTable?: object): T {
        let table = initialTable;
        const recorded = this.recorded;
        const proxy: T = new Proxy(builder, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (typeof value !== "function") return value;
                if (prop === "then") return (value as (...a: unknown[]) => unknown).bind(target);
                return (...args: unknown[]) => {
                    if (prop === "from") table = args[0] as object;
                    if (prop === "where") {
                        recorded.push({ op, table, where: args[0] as SQL | undefined });
                    }
                    const result = (value as (...a: unknown[]) => unknown).apply(target, args);
                    return result === target ? proxy : result;
                };
            },
        });
        return proxy;
    }

    // The fake's builders, wrapped; the `where` each write gets is recorded by
    // `wrap`, so the delete below is never unconditional.
    private readonly inner = fakeDb.db;

    readonly db = {
        select: (...args: unknown[]) =>
            this.wrap((this.inner.select as (...a: unknown[]) => object)(...args), "select"),
        selectDistinct: (...args: unknown[]) =>
            this.wrap(
                (this.inner.selectDistinct as (...a: unknown[]) => object)(...args),
                "select"
            ),
        insert: (table: object) => this.inner.insert(table),
        update: (table: object) => this.wrap(this.inner.update(table), "update", table),
        delete: (table: object) => this.wrap(this.inner.delete(table), "delete", table),
        transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(this.db),
    };
}

export const recordingDb = new RecordingDb();
