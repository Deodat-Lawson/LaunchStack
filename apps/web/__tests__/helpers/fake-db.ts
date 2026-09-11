/**
 * An in-memory stand-in for the Drizzle client, for route and service tests.
 *
 * It does not interpret predicates. Selects answer from a per-table queue the
 * test fills (`onSelect`); the last queued result sticks, so one row set can
 * serve every read of that table in a request. Writes are recorded so a test
 * can assert on what was inserted, updated, or deleted — the audit rows in
 * particular — without a database.
 *
 * Wire it in with:
 *
 *   jest.mock("~/server/db", () => ({
 *       db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
 *   }));
 *
 * and call `fakeDb.reset()` in `beforeEach`.
 */

type Row = Record<string, unknown>;
type Table = object;

interface Insert {
    table: Table;
    values: Row[];
}
interface Update {
    table: Table;
    set: Row;
}
interface Delete {
    table: Table;
}

class FakeDb {
    private selectQueues = new Map<Table, Row[][]>();
    private returningQueues = new Map<Table, Row[][]>();
    private nextId = 1000;

    inserts: Insert[] = [];
    updates: Update[] = [];
    deletes: Delete[] = [];

    reset(): void {
        this.selectQueues.clear();
        this.returningQueues.clear();
        this.inserts = [];
        this.updates = [];
        this.deletes = [];
        this.nextId = 1000;
    }

    /** Queue results for selects whose `.from()` is `table`; the last one repeats. */
    onSelect(table: Table, ...results: Row[][]): void {
        const queue = this.selectQueues.get(table) ?? [];
        queue.push(...results);
        this.selectQueues.set(table, queue);
    }

    /** Queue results for `.returning()` on writes to `table`; the last one repeats. */
    onReturning(table: Table, ...results: Row[][]): void {
        const queue = this.returningQueues.get(table) ?? [];
        queue.push(...results);
        this.returningQueues.set(table, queue);
    }

    insertedInto(table: Table): Row[] {
        return this.inserts.filter(i => i.table === table).flatMap(i => i.values);
    }

    updatesOf(table: Table): Row[] {
        return this.updates.filter(u => u.table === table).map(u => u.set);
    }

    deletesOf(table: Table): number {
        return this.deletes.filter(d => d.table === table).length;
    }

    private take(queues: Map<Table, Row[][]>, table: Table): Row[] | undefined {
        const queue = queues.get(table);
        if (!queue || queue.length === 0) return undefined;
        return queue.length === 1 ? queue[0] : queue.shift();
    }

    private selectResult(table: Table | undefined): Row[] {
        if (!table) return [];
        return this.take(this.selectQueues, table) ?? [];
    }

    private returningResult(table: Table, fallback: Row[]): Row[] {
        return this.take(this.returningQueues, table) ?? fallback;
    }

    private selectBuilder() {
        let fromTable: Table | undefined;
        const builder = {
            from: (table: Table) => {
                fromTable = table;
                return builder;
            },
            innerJoin: () => builder,
            leftJoin: () => builder,
            where: () => builder,
            orderBy: () => builder,
            limit: () => builder,
            offset: () => builder,
            groupBy: () => builder,
            for: () => builder,
            then: (
                resolve: (value: Row[]) => unknown,
                reject?: (reason: unknown) => unknown
            ): Promise<unknown> =>
                Promise.resolve(this.selectResult(fromTable)).then(resolve, reject),
        };
        return builder;
    }

    private insertBuilder(table: Table) {
        let inserted: Row[] = [];
        const builder = {
            values: (values: Row | Row[]) => {
                inserted = Array.isArray(values) ? values : [values];
                this.inserts.push({ table, values: inserted });
                return builder;
            },
            onConflictDoNothing: () => builder,
            onConflictDoUpdate: () => builder,
            returning: () =>
                Promise.resolve(
                    this.returningResult(
                        table,
                        inserted.map(row => ({ id: this.nextId++, ...row }))
                    )
                ),
            then: (
                resolve: (value: unknown) => unknown,
                reject?: (reason: unknown) => unknown
            ): Promise<unknown> => Promise.resolve(undefined).then(resolve, reject),
        };
        return builder;
    }

    private updateBuilder(table: Table) {
        const builder = {
            set: (values: Row) => {
                this.updates.push({ table, set: values });
                return builder;
            },
            where: () => builder,
            returning: () => Promise.resolve(this.returningResult(table, [])),
            then: (
                resolve: (value: unknown) => unknown,
                reject?: (reason: unknown) => unknown
            ): Promise<unknown> => Promise.resolve(undefined).then(resolve, reject),
        };
        return builder;
    }

    private deleteBuilder(table: Table) {
        this.deletes.push({ table });
        const builder = {
            where: () => builder,
            returning: () => Promise.resolve(this.returningResult(table, [])),
            then: (
                resolve: (value: unknown) => unknown,
                reject?: (reason: unknown) => unknown
            ): Promise<unknown> => Promise.resolve(undefined).then(resolve, reject),
        };
        return builder;
    }

    readonly db = {
        select: () => this.selectBuilder(),
        selectDistinct: () => this.selectBuilder(),
        insert: (table: Table) => this.insertBuilder(table),
        update: (table: Table) => this.updateBuilder(table),
        delete: (table: Table) => this.deleteBuilder(table),
        transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(this.db),
    };
}

export const fakeDb = new FakeDb();
export type { FakeDb };
