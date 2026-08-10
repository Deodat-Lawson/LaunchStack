import { validateNoteTarget } from "~/server/notes/validate-note-target";

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
  },
}));

function setupQuery(rows: Record<string, unknown>[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  mockDbSelect.mockReturnValueOnce({ from });
}

const COMPANY = BigInt(5);

describe("validateNoteTarget", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows a freeform note with no document", async () => {
    const result = await validateNoteTarget({
      documentId: null,
      versionId: null,
      companyId: COMPANY,
    });

    expect(result.ok).toBe(true);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("rejects a version without a document", async () => {
    const result = await validateNoteTarget({
      documentId: null,
      versionId: 9,
      companyId: COMPANY,
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
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("rejects a version that belongs to a different document", async () => {
    setupQuery([{ id: 42 }]);
    setupQuery([]);

    const result = await validateNoteTarget({
      documentId: "42",
      versionId: 9,
      companyId: COMPANY,
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
    });

    expect(result.ok).toBe(true);
  });
});
