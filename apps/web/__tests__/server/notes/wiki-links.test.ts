import { searchWikiLinkCandidates } from "~/server/notes/wiki-links";

const mockSelect = jest.fn();
const wherePredicates: unknown[] = [];
let queuedRows: unknown[][] = [];
type QueryBuilder = {
  from: () => QueryBuilder;
  where: (predicate: unknown) => QueryBuilder;
  limit: () => Promise<unknown[]>;
};

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

jest.mock("~/server/db/schema", () => ({
  documentNotes: {
    id: "notes.id",
    title: "notes.title",
    companyId: "notes.companyId",
    userId: "notes.userId",
  },
  noteLinks: {
    sourceNoteId: "links.sourceNoteId",
  },
  users: {
    companyId: "users.companyId",
    userId: "users.userId",
  },
}));

jest.mock("@launchstack/store/schema", () => ({
  document: {
    id: "document.id",
    title: "document.title",
    companyId: "document.companyId",
  },
}));

jest.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
  isNull: (column: unknown) => ({ op: "isNull", column }),
  or: (...conditions: unknown[]) => ({ op: "or", conditions }),
  sql: () => ({ op: "sql" }),
}));

function setupRows(...rows: unknown[][]) {
  queuedRows = [...rows];
  mockSelect.mockImplementation(() => {
    const result = queuedRows.shift() ?? [];
    const builder: QueryBuilder = {
      from: () => builder,
      where: (predicate) => {
        wherePredicates.push(predicate);
        return builder;
      },
      limit: () => Promise.resolve(result),
    };
    return builder;
  });
}

describe("searchWikiLinkCandidates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queuedRows = [];
    wherePredicates.length = 0;
  });

  // The typeahead must offer what `resolveRefs` will actually link to, and
  // that resolves note targets workspace-wide. An author-only picker hid
  // exactly the teammate notes a typed link still resolved to: the reference
  // landed in the database while the UI claimed the note did not exist.
  it("scopes note typeahead to the active workspace, not just the author", async () => {
    setupRows([], [{ id: 1, title: "Quarterly plan" }]);

    await searchWikiLinkCandidates("plan", {
      companyId: "5",
      userId: "user-a",
    });

    const notesPredicate = wherePredicates[1] as {
      op: string;
      conditions: Array<unknown>;
    };
    expect(notesPredicate.op).toBe("and");
    expect(notesPredicate.conditions).toEqual(
      expect.arrayContaining([
        {
          op: "or",
          conditions: [
            { op: "eq", args: ["notes.companyId", "5"] },
            // Legacy rows carry no company, so they belong to no workspace
            // and stay scoped to their author.
            {
              op: "and",
              conditions: [
                { op: "isNull", column: "notes.companyId" },
                { op: "eq", args: ["notes.userId", "user-a"] },
              ],
            },
          ],
        },
      ]),
    );
  });

  it("falls back to the caller's own uncompanied notes with no workspace", async () => {
    setupRows([], [{ id: 1, title: "Quarterly plan" }]);

    await searchWikiLinkCandidates("plan", {
      companyId: null,
      userId: "user-a",
    });

    const notesPredicate = wherePredicates[0] as {
      op: string;
      conditions: Array<unknown>;
    };
    expect(notesPredicate.conditions).toEqual(
      expect.arrayContaining([
        {
          op: "and",
          conditions: [
            { op: "isNull", column: "notes.companyId" },
            { op: "eq", args: ["notes.userId", "user-a"] },
          ],
        },
      ]),
    );
  });
});
