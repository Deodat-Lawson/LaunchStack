import { validateNoteTarget } from "~/server/notes/validate-note-target";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { SCOPE_EVERYTHING, type DocumentScope } from "~/lib/authz/scope-types";

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
  },
}));

jest.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

jest.mock("@launchstack/store/schema", () => ({
  document: { id: "document.id", companyId: "document.companyId" },
  documentVersions: { id: "versions.id", documentId: "versions.documentId" },
}));

jest.mock("~/lib/authz/scope", () => ({
  scopedDocumentWhere: jest.fn((companyId: bigint, scope: unknown) => ({
    op: "scoped",
    companyId,
    scope,
  })),
}));

const wherePredicates: unknown[] = [];

function setupQuery(rows: Record<string, unknown>[]) {
  const where = jest.fn((predicate: unknown) => {
    wherePredicates.push(predicate);
    return Promise.resolve(rows);
  });
  const from = jest.fn().mockReturnValue({ where });
  mockDbSelect.mockReturnValueOnce({ from });
}

const COMPANY = BigInt(5);
const FINANCE_HIDDEN: DocumentScope = {
  kind: "except",
  deniedCategories: ["Finance"],
  deniedDocumentIds: [],
  allowedDocumentIds: [],
};

describe("validateNoteTarget", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    wherePredicates.length = 0;
  });

  it("allows a freeform note with no document", async () => {
    const result = await validateNoteTarget({
      documentId: null,
      versionId: null,
      companyId: COMPANY,
      scope: SCOPE_EVERYTHING,
    });

    expect(result.ok).toBe(true);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("rejects a version without a document", async () => {
    const result = await validateNoteTarget({
      documentId: null,
      versionId: 9,
      companyId: COMPANY,
      scope: SCOPE_EVERYTHING,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("rejects a document owned by another workspace", async () => {
    setupQuery([]);

    const result = await validateNoteTarget({
      documentId: "42",
      versionId: null,
      companyId: COMPANY,
      scope: SCOPE_EVERYTHING,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("reads a document outside the caller's scope as missing, through the scoped predicate", async () => {
    setupQuery([]);

    const result = await validateNoteTarget({
      documentId: "42",
      versionId: null,
      companyId: COMPANY,
      scope: FINANCE_HIDDEN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
    expect(scopedDocumentWhere).toHaveBeenCalledWith(COMPANY, FINANCE_HIDDEN);
    expect(wherePredicates[0]).toEqual(
      expect.objectContaining({
        op: "and",
        args: expect.arrayContaining([
          { op: "scoped", companyId: COMPANY, scope: FINANCE_HIDDEN },
        ]),
      }),
    );
  });

  it("rejects a version that belongs to a different document", async () => {
    setupQuery([{ id: 42 }]);
    setupQuery([]);

    const result = await validateNoteTarget({
      documentId: "42",
      versionId: 9,
      companyId: COMPANY,
      scope: SCOPE_EVERYTHING,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("accepts a document and one of its versions", async () => {
    setupQuery([{ id: 42 }]);
    setupQuery([{ id: BigInt(9) }]);

    const result = await validateNoteTarget({
      documentId: "42",
      versionId: 9,
      companyId: COMPANY,
      scope: SCOPE_EVERYTHING,
    });

    expect(result.ok).toBe(true);
  });
});
