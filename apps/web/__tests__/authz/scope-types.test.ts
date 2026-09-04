import {
    SCOPE_EVERYTHING,
    SCOPE_NOTHING,
    filterDocumentsByScope,
    scopeAllowsCategory,
    scopeAllowsDocument,
    scopeSize,
    type DocumentScope,
} from "~/lib/authz/scope-types";

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

describe("scopeAllowsDocument", () => {
    it("allows everything for the everything scope", () => {
        expect(scopeAllowsDocument(SCOPE_EVERYTHING, { id: 1, category: "Finance" })).toBe(true);
    });

    it("allows nothing for the nothing scope", () => {
        expect(scopeAllowsDocument(SCOPE_NOTHING, { id: 1, category: "" })).toBe(false);
    });

    it("denies restricted folders and documents, but honours explicit grants", () => {
        expect(scopeAllowsDocument(except, { id: 1, category: "General" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 1, category: "Finance" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 42, category: "General" })).toBe(false);
        expect(scopeAllowsDocument(except, { id: 7, category: "Finance" })).toBe(true);
        expect(scopeAllowsDocument(except, { id: 3, category: null })).toBe(true);
    });

    it("only allows granted folders and documents for guests", () => {
        expect(scopeAllowsDocument(only, { id: 1, category: "Shared" })).toBe(true);
        expect(scopeAllowsDocument(only, { id: 9, category: "Shared" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 1, category: "General" })).toBe(false);
        expect(scopeAllowsDocument(only, { id: 11, category: "General" })).toBe(true);
    });
});

describe("scopeAllowsCategory", () => {
    it("mirrors the folder rule of each shape", () => {
        expect(scopeAllowsCategory(SCOPE_EVERYTHING, "Finance")).toBe(true);
        expect(scopeAllowsCategory(except, "Finance")).toBe(false);
        expect(scopeAllowsCategory(except, "General")).toBe(true);
        expect(scopeAllowsCategory(only, "Shared")).toBe(true);
        expect(scopeAllowsCategory(only, "General")).toBe(false);
    });
});

describe("filterDocumentsByScope", () => {
    it("keeps only what the scope allows and copies the everything case", () => {
        const docs = [
            { id: 1, category: "General" },
            { id: 2, category: "Finance" },
            { id: 7, category: "Finance" },
            { id: 42, category: "General" },
        ];
        expect(filterDocumentsByScope(except, docs).map(d => d.id)).toEqual([1, 7]);
        const all = filterDocumentsByScope(SCOPE_EVERYTHING, docs);
        expect(all).toEqual(docs);
        expect(all).not.toBe(docs);
    });
});

describe("scopeSize", () => {
    it("counts the lists that shape the scope", () => {
        expect(scopeSize(SCOPE_EVERYTHING)).toBe(0);
        expect(scopeSize(except)).toBe(3);
        expect(scopeSize(only)).toBe(3);
    });
});
