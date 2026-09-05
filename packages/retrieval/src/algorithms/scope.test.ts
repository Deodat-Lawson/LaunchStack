/**
 * Renders the scope predicate through the real Postgres dialect so the test
 * asserts the SQL a leg would actually send, not a mock of drizzle.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import type { DocumentScope } from "../search-types";
import {
    documentScopeSql,
    documentScopeSqlForAlias,
    scopeAllowsCategory,
    scopeAllowsDocument,
    scopeFolderRules,
} from "./scope";

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

    it("denies folders and their subfolders, denies documents, then re-allows explicit grants", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "except",
                deniedCategories: ["Finance", "Legal"],
                deniedDocumentIds: [42],
                allowedDocumentIds: [7],
            })
        );
        expect(sql).toMatch(
            /case when \("[^"]+"\."category" = \$1 or "[^"]+"\."category" like \$2\) then true|false/i
        );
        expect(sql).toMatch(/then false .*then false else true end/i);
        expect(sql).toMatch(/"id" not in \(\$5\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$6\)/);
        expect(params).toEqual(["Finance", "Finance/%", "Legal", "Legal/%", 42, 7]);
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
        expect(sql).toMatch(/case when .* then false else true end/i);
        expect(sql).not.toMatch(/"id"/);
        expect(params).toEqual(["Finance", "Finance/%"]);
    });

    it("lets a granted subfolder beneath a denied folder through — nearest ancestor wins", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "except",
                deniedCategories: ["Finance"],
                allowedCategories: ["Finance/Shared"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            })
        );
        // The deeper rule renders first, so it is the one CASE picks.
        expect(params).toEqual(["Finance/Shared", "Finance/Shared/%", "Finance", "Finance/%"]);
        expect(sql).toMatch(/then true when .* then false else true end/i);
    });

    it("escapes LIKE metacharacters in folder paths", () => {
        const { params } = render(
            documentScopeSql({
                kind: "except",
                deniedCategories: ["100%_done"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            })
        );
        expect(params).toEqual(["100%_done", "100\\%\\_done/%"]);
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
        expect(sql).toMatch(/case when .* then true else false end/i);
        expect(sql).toMatch(/"id" not in \(\$3\)/);
        expect(sql).toMatch(/ or .*"id" in \(\$4\)/);
        expect(params).toEqual(["Shared", "Shared/%", 9, 11]);
    });

    it("allow-lists only explicit documents when there are no folders", () => {
        const { sql, params } = render(
            documentScopeSql({
                kind: "only",
                allowedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: [11],
            })
        );
        expect(sql).toMatch(/false or .*"id" in \(\$1\)/);
        expect(params).toEqual([11]);
    });

    it("reads the aliased document columns and binds values as parameters", () => {
        const { sql, params } = render(
            documentScopeSqlForAlias(
                {
                    kind: "except",
                    deniedCategories: ["Finance"],
                    deniedDocumentIds: [3],
                    allowedDocumentIds: [],
                },
                "d"
            )
        );
        expect(sql).toMatch(/"d"\.category = \$1 or "d"\.category like \$2/i);
        expect(sql).toMatch(/"d"\.id not in \(\$3\)/);
        expect(params).toEqual(["Finance", "Finance/%", 3]);
        expect(sql).not.toContain("Finance");
    });

    it("is absent for everything", () => {
        expect(documentScopeSqlForAlias(EVERYTHING, "d")).toBeUndefined();
    });
});

describe("scopeFolderRules", () => {
    it("orders rules deepest first", () => {
        const rules = scopeFolderRules({
            kind: "except",
            deniedCategories: ["Finance", "Finance/Shared/Secret"],
            allowedCategories: ["Finance/Shared"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        });
        expect(rules.map(r => r.path)).toEqual([
            "Finance/Shared/Secret",
            "Finance/Shared",
            "Finance",
        ]);
    });
});

describe("scopeAllowsDocument", () => {
    const except: DocumentScope = {
        kind: "except",
        deniedCategories: ["Finance"],
        allowedCategories: ["Finance/Shared"],
        deniedDocumentIds: [42],
        allowedDocumentIds: [7],
    };
    const only: DocumentScope = {
        kind: "only",
        allowedCategories: ["Shared"],
        deniedCategories: ["Shared/Private"],
        deniedDocumentIds: [9],
        allowedDocumentIds: [11],
    };

    it("allows everything under no scope", () => {
        expect(scopeAllowsDocument(undefined, { id: 1, category: "Finance" })).toBe(true);
        expect(scopeAllowsDocument(EVERYTHING, { id: 1, category: "Finance" })).toBe(true);
    });

    it("applies the except rules to folders and their subfolders", () => {
        expect(scopeAllowsDocument(except, { id: 1, category: "General" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance/Q3" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance/Shared" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance/Shared/Deck" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 1, category: "Financeiro" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 42, category: "General" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 7, category: "Finance" })).toBe(true);
    });

    it("applies the only rules to folders and their subfolders", () => {
        expect(scopeAllowsDocument(only, { id: 1, category: "Shared" })).toBe(true);
        expect(scopeAllowsDocument(only, { id: 1, category: "Shared/Q3" })).toBe(true);
        expect(scopeAllowsDocument(only, { id: 1, category: "Shared/Private" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 9, category: "Shared" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 1, category: "General" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 11, category: "General" })).toBe(true);
    });

    it("treats a missing category as the empty folder", () => {
        expect(scopeAllowsDocument(except, { id: 1, category: null })).toBe(true);
        expect(scopeAllowsDocument(only, { id: 1, category: undefined })).toBe(false);
    });

    it("answers for a folder alone", () => {
        expect(scopeAllowsCategory(except, "Finance/Q3")).toBe(false);
        expect(scopeAllowsCategory(except, "Finance/Shared/Deck")).toBe(true);
        expect(scopeAllowsCategory(only, "Shared/Private/Deep")).toBe(false);
    });
});
