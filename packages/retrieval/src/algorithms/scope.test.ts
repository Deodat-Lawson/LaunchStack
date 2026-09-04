/**
 * Renders the scope predicate through the real Postgres dialect so the test
 * asserts the SQL a leg would actually send, not a mock of drizzle.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import type { DocumentScope } from "../search-types";
import { documentScopeSql, documentScopeSqlForAlias, scopeAllowsDocument } from "./scope";

const dialect = new PgDialect();
const render = (chunk: SQL | undefined) => {
    if (!chunk) return { sql: "", params: [] as unknown[] };
    const { sql, params } = dialect.sqlToQuery(chunk);
    return { sql, params };
};

const EVERYTHING: DocumentScope = { kind: "everything" };
const NOTHING: DocumentScope = {
    kind: "only",
    allowedCategories: [],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

describe("documentScopeSql", () => {
    it("is absent when there is no scope or the scope is everything", () => {
        expect(documentScopeSql(undefined)).toBeUndefined();
        expect(documentScopeSql(EVERYTHING)).toBeUndefined();
    });

    it("is false when a guest may see nothing", () => {
        expect(render(documentScopeSql(NOTHING)).sql).toBe("false");
    });

    it("denies folders and documents, then re-allows explicit grants", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "except",
                deniedCategories: ["Finance", "Legal"],
                deniedDocumentIds: [42],
                allowedDocumentIds: [7],
            })
        );
        expect(sql).toMatch(/"category" not in \(\$1, \$2\)/);
        expect(sql).toMatch(/"id" not in \(\$3\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$4\)/);
        expect(params).toEqual(["Finance", "Legal", 42, 7]);
    });

    it("omits empty lists and is absent when nothing is denied", () => {
        expect(
            documentScopeSql({
                kind: "except",
                deniedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: [7],
            })
        ).toBeUndefined();

        const { sql, params } = render(
            documentScopeSql({
                kind: "except",
                deniedCategories: ["Finance"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            })
        );
        expect(sql).toMatch(/"category" not in \(\$1\)/);
        expect(sql).not.toMatch(/"id"/);
        expect(params).toEqual(["Finance"]);
    });

    it("allow-lists folders minus restricted documents, plus explicit grants", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "only",
                allowedCategories: ["Shared"],
                deniedDocumentIds: [9],
                allowedDocumentIds: [11],
            })
        );
        expect(sql).toMatch(/"category" in \(\$1\) and .*"id" not in \(\$2\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$3\)/);
        expect(params).toEqual(["Shared", 9, 11]);
    });

    it("allow-lists only explicit documents when there are no folders", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "only",
                allowedCategories: [],
                deniedDocumentIds: [3],
                allowedDocumentIds: [11],
            })
        );
        expect(sql).toMatch(/"id" in \(\$1\)/);
        expect(sql).not.toMatch(/category/);
        // A denied id without an allowed folder has nothing to subtract from.
        expect(params).toEqual([11]);
    });
});

describe("documentScopeSqlForAlias", () => {
    it("reads the aliased document columns and binds values as parameters", () => {
        const { sql, params } = render(
            documentScopeSqlForAlias(
                {
                    kind: "except",
                    deniedCategories: ["Finance"],
                    deniedDocumentIds: [42],
                    allowedDocumentIds: [],
                },
                "d"
            )
        );
        expect(sql).toBe('("d".category not in ($1) and "d".id not in ($2))');
        expect(params).toEqual(["Finance", 42]);
    });

    it("is absent for everything", () => {
        expect(documentScopeSqlForAlias(EVERYTHING, "d")).toBeUndefined();
        expect(documentScopeSqlForAlias(undefined, "d")).toBeUndefined();
    });
});

describe("scopeAllowsDocument", () => {
    const except: DocumentScope = {
        kind: "except",
        deniedCategories: ["Finance"],
        deniedDocumentIds: [42],
        allowedDocumentIds: [7],
    };
    const only: DocumentScope = {
        kind: "only",
        allowedCategories: ["Shared"],
        deniedDocumentIds: [9],
        allowedDocumentIds: [11],
    };

    it("allows everything under no scope", () => {
        expect(scopeAllowsDocument(undefined, { id: 1, category: "Finance" })).toBe(true);
        expect(scopeAllowsDocument(EVERYTHING, { id: 1, category: null })).toBe(true);
    });

    it("applies the except rules", () => {
        expect(scopeAllowsDocument(except, { id: 1, category: "Ops" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 42, category: "Ops" })).toBe(false);
        // An explicit grant wins over both denials.
        expect(scopeAllowsDocument(except, { id: 7, category: "Finance" })).toBe(true);
    });

    it("applies the only rules", () => {
        expect(scopeAllowsDocument(only, { id: 1, category: "Shared" })).toBe(true);
        expect(scopeAllowsDocument(only, { id: 1, category: "Ops" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 9, category: "Shared" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 11, category: "Ops" })).toBe(true);
        expect(scopeAllowsDocument(NOTHING, { id: 1, category: "Shared" })).toBe(false);
    });

    it("treats a missing category as the empty folder", () => {
        expect(scopeAllowsDocument(only, { id: 1, category: undefined })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 1, category: undefined })).toBe(true);
    });
});
