/**
 * Renders the scope predicate through the real Postgres dialect so the test
 * asserts the SQL a route would actually send, not a mock of drizzle.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { documentScopePredicate, scopedDocumentWhere } from "~/lib/authz/scope";
import { SCOPE_EVERYTHING, SCOPE_NOTHING, type DocumentScope } from "~/lib/authz/scope-types";

jest.mock("~/server/db", () => ({ db: {} }));

const dialect = new PgDialect();
const render = (chunk: SQL | undefined) => {
    if (!chunk) return { sql: "", params: [] as unknown[] };
    const { sql, params } = dialect.sqlToQuery(chunk);
    return { sql, params };
};

describe("documentScopePredicate", () => {
    it("is absent for the everything scope", () => {
        expect(documentScopePredicate(SCOPE_EVERYTHING)).toBeUndefined();
    });

    it("is false for the nothing scope", () => {
        const { sql } = render(documentScopePredicate(SCOPE_NOTHING));
        expect(sql).toBe("false");
    });

    it("denies folders and documents, then re-allows explicit grants", () => {
        const scope: DocumentScope = {
            kind: "except",
            deniedCategories: ["Finance", "Legal"],
            deniedDocumentIds: [42],
            allowedDocumentIds: [7],
        };
        const { sql, params } = render(documentScopePredicate(scope));
        expect(sql).toMatch(/"category" not in \(\$1, \$2\)/);
        expect(sql).toMatch(/"id" not in \(\$3\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$4\)/);
        expect(params).toEqual(["Finance", "Legal", 42, 7]);
    });

    it("omits empty lists and returns undefined when nothing is denied", () => {
        const scope: DocumentScope = {
            kind: "except",
            deniedCategories: [],
            deniedDocumentIds: [],
            allowedDocumentIds: [7],
        };
        expect(documentScopePredicate(scope)).toBeUndefined();

        const foldersOnly: DocumentScope = {
            kind: "except",
            deniedCategories: ["Finance"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        };
        const { sql, params } = render(documentScopePredicate(foldersOnly));
        expect(sql).toMatch(/"category" not in \(\$1\)/);
        expect(sql).not.toMatch(/"id"/);
        expect(params).toEqual(["Finance"]);
    });

    it("allow-lists folders for guests, minus restricted documents, plus explicit grants", () => {
        const scope: DocumentScope = {
            kind: "only",
            allowedCategories: ["Shared"],
            deniedDocumentIds: [9],
            allowedDocumentIds: [11],
        };
        const { sql, params } = render(documentScopePredicate(scope));
        expect(sql).toMatch(/"category" in \(\$1\) and .*"id" not in \(\$2\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$3\)/);
        expect(params).toEqual(["Shared", 9, 11]);
    });

    it("allow-lists only explicit documents when a guest has no folders", () => {
        const scope: DocumentScope = {
            kind: "only",
            allowedCategories: [],
            deniedDocumentIds: [],
            allowedDocumentIds: [11],
        };
        const { sql, params } = render(documentScopePredicate(scope));
        expect(sql).toMatch(/"id" in \(\$1\)/);
        expect(sql).not.toMatch(/category/);
        expect(params).toEqual([11]);
    });
});

describe("scopedDocumentWhere", () => {
    it("always pins the company and adds the scope when there is one", () => {
        const everything = render(scopedDocumentWhere(BigInt(5), SCOPE_EVERYTHING));
        expect(everything.sql).toMatch(/"company_id" = \$1/);
        expect(everything.params).toEqual([BigInt(5)]);

        const scoped = render(
            scopedDocumentWhere(BigInt(5), {
                kind: "except",
                deniedCategories: ["Finance"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            })
        );
        expect(scoped.sql).toMatch(/"company_id" = \$1 and .*"category" not in \(\$2\)/);
        expect(scoped.params).toEqual([BigInt(5), "Finance"]);
    });
});
