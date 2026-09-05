/**
 * The three states an anchor can land in, pinned.
 *
 * The interesting one is the third: an anchor that resolves to no document is
 * VISIBLE. `document_notes.document_id` is a varchar with no foreign key,
 * `deleteDocumentCore` does not cascade to it, and the only statement that
 * deletes a note is the author deleting it — so hiding unresolvable anchors
 * would make deleting a document silently destroy the author's own notes.
 */

import { isNoteDocumentVisible, filterNotesByDocumentScope } from "~/server/notes/document-scope";
import { SCOPE_EVERYTHING, type DocumentScope } from "~/lib/authz/scope-types";
import type * as ScopeTypes from "~/lib/authz/scope-types";

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    },
}));

jest.mock("drizzle-orm", () => ({
    inArray: (...args: unknown[]) => ({ op: "inArray", args }),
}));

jest.mock("@launchstack/store/schema", () => ({
    document: { id: "document.id", category: "document.category", companyId: "document.companyId" },
}));

// The real decision, not a stand-in: `scopeAllows` in ~/lib/authz/scope is a
// thin wrapper over the dependency-free `scopeAllowsDocument`, and mocking the
// wrapper is the only way to reach it without importing the db-bound module.
jest.mock("~/lib/authz/scope", () => {
    const actual = jest.requireActual<typeof ScopeTypes>("~/lib/authz/scope-types");
    return {
        scopeAllows: (
            scope: DocumentScope,
            doc: { id: number | bigint; category: string | null }
        ) => actual.scopeAllowsDocument(scope, { id: Number(doc.id), category: doc.category }),
    };
});

const COMPANY = BigInt(5);
const OTHER_COMPANY = BigInt(6);

const FINANCE_HIDDEN: DocumentScope = {
    kind: "except",
    deniedCategories: ["Finance"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

/** One `select().from().where()` chain resolving to `rows`. */
function setupQuery(rows: Record<string, unknown>[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValueOnce({ from });
}

const row = (id: number, category: string | null, companyId = COMPANY) => ({
    id,
    category,
    companyId,
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe("isNoteDocumentVisible", () => {
    it("keeps an unanchored note without querying", async () => {
        await expect(isNoteDocumentVisible(null, COMPANY, FINANCE_HIDDEN)).resolves.toBe(true);
        await expect(isNoteDocumentVisible("", COMPANY, FINANCE_HIDDEN)).resolves.toBe(true);
        await expect(isNoteDocumentVisible("   ", COMPANY, FINANCE_HIDDEN)).resolves.toBe(true);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("short-circuits the everything scope without querying", async () => {
        await expect(isNoteDocumentVisible("7", COMPANY, SCOPE_EVERYTHING)).resolves.toBe(true);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("keeps a note whose document the scope allows", async () => {
        setupQuery([row(7, "Product")]);
        await expect(isNoteDocumentVisible("7", COMPANY, FINANCE_HIDDEN)).resolves.toBe(true);
    });

    it("hides a note whose document sits in a denied folder", async () => {
        setupQuery([row(7, "Finance")]);
        await expect(isNoteDocumentVisible("7", COMPANY, FINANCE_HIDDEN)).resolves.toBe(false);
    });

    it("hides a note whose document sits beneath a denied folder", async () => {
        setupQuery([row(7, "Finance/Q3")]);
        await expect(isNoteDocumentVisible("7", COMPANY, FINANCE_HIDDEN)).resolves.toBe(false);
    });

    it("hides a note anchored across companies whatever the scope says", async () => {
        setupQuery([row(7, "Product", OTHER_COMPANY)]);
        await expect(isNoteDocumentVisible("7", COMPANY, FINANCE_HIDDEN)).resolves.toBe(false);
    });

    it("keeps a note whose document no longer exists", async () => {
        setupQuery([]);
        await expect(isNoteDocumentVisible("7", COMPANY, FINANCE_HIDDEN)).resolves.toBe(true);
    });

    it("keeps a note whose anchor is not a number", async () => {
        await expect(isNoteDocumentVisible("not-an-id", COMPANY, FINANCE_HIDDEN)).resolves.toBe(
            true
        );
        expect(mockDbSelect).not.toHaveBeenCalled();
    });
});

describe("filterNotesByDocumentScope", () => {
    it("returns everything untouched on the everything scope, without querying", async () => {
        const notes = [{ documentId: "7" }, { documentId: null }];
        await expect(filterNotesByDocumentScope(notes, COMPANY, SCOPE_EVERYTHING)).resolves.toEqual(
            notes
        );
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("drops only the denied and cross-company anchors, in one query", async () => {
        setupQuery([
            row(1, "Product"),
            row(2, "Finance"),
            row(4, "Product", OTHER_COMPANY),
            // 5 is absent: its document was deleted.
        ]);

        const notes = [
            { id: "keep-allowed", documentId: "1" },
            { id: "drop-denied", documentId: "2" },
            { id: "keep-unanchored", documentId: null },
            { id: "drop-cross-company", documentId: "4" },
            { id: "keep-dangling", documentId: "5" },
        ];

        const kept = await filterNotesByDocumentScope(notes, COMPANY, FINANCE_HIDDEN);

        expect(kept.map(n => n.id)).toEqual(["keep-allowed", "keep-unanchored", "keep-dangling"]);
        expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it("preserves the caller's ordering", async () => {
        setupQuery([row(1, "Product"), row(2, "Product"), row(3, "Product")]);
        const notes = [{ documentId: "3" }, { documentId: "1" }, { documentId: "2" }];
        const kept = await filterNotesByDocumentScope(notes, COMPANY, FINANCE_HIDDEN);
        expect(kept.map(n => n.documentId)).toEqual(["3", "1", "2"]);
    });

    it("does not query for an empty list", async () => {
        await expect(filterNotesByDocumentScope([], COMPANY, FINANCE_HIDDEN)).resolves.toEqual([]);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });
});
