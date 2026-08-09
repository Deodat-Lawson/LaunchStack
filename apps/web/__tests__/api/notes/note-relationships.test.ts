/**
 * A note's `documentId` / `versionId` come straight from the client and are
 * stored verbatim, so without a relationship check a note could be filed
 * against another workspace's document (and then appear in that document's
 * note list) or against a version belonging to a different document. These
 * tests exercise both note-creation routes through the real
 * `validateNoteTarget` boundary.
 */

import { POST as createNote } from "~/app/api/notes/route";
import { POST as aiCapture } from "~/app/api/notes/ai-capture/route";
import { captureFromSelection } from "~/server/notes/ai-capture";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

jest.mock("~/lib/require-workspace-context", () => {
  const actual = jest.requireActual("~/lib/require-workspace-context");
  return { ...actual, requireWorkspaceContext: jest.fn() };
});

let mockQueuedRows: Record<string, unknown>[][] = [];
const mockSelectCount = { value: 0 };
const mockInsert = jest.fn();

function mockBuilder() {
  mockSelectCount.value += 1;
  const rows = mockQueuedRows.shift() ?? [];

  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  };
  for (const method of ["from", "where", "orderBy", "limit"]) {
    builder[method] = () => builder;
  }
  return builder;
}

jest.mock("~/server/db", () => ({
  db: {
    select: () => mockBuilder(),
    insert: (...args: unknown[]) => mockInsert(...args) as unknown,
  },
}));

jest.mock("@launchstack/core/db/schema", () => ({
  document: { id: "document.id", companyId: "document.companyId" },
  documentVersions: { id: "versions.id", documentId: "versions.documentId" },
}));

jest.mock("~/server/db/schema", () => ({
  documentNotes: {
    id: "notes.id",
    userId: "notes.userId",
    companyId: "notes.companyId",
    documentId: "notes.documentId",
    title: "notes.title",
    tags: "notes.tags",
    anchorStatus: "notes.anchorStatus",
    createdAt: "notes.createdAt",
  },
}));

jest.mock("drizzle-orm", () => {
  const op = (name: string) =>
    (...args: unknown[]) => ({ op: name, args });
  return {
    eq: op("eq"),
    and: op("and"),
    or: op("or"),
    desc: op("desc"),
    ilike: op("ilike"),
    arrayContains: op("arrayContains"),
    isNull: op("isNull"),
    inArray: op("inArray"),
  };
});

jest.mock("~/server/notes/embed-note", () => ({
  embedNoteAsync: jest.fn(),
}));

jest.mock("~/server/notes/serialize", () => ({
  serializeNote: (note: unknown) => note,
}));

jest.mock("~/server/notes/wiki-links", () => ({
  syncNoteLinks: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("~/server/notes/search", () => ({
  searchNotes: jest.fn().mockResolvedValue([]),
}));

jest.mock("~/server/notes/ai-capture", () => ({
  captureFromSelection: jest
    .fn()
    .mockResolvedValue({ markdown: "captured", suggestedTitle: "Title" }),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
  withRateLimit: (
    _request: Request,
    _config: unknown,
    handler: () => Promise<Response>,
  ) => handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
  RateLimitPresets: { strict: {} },
}));

const CTX: WorkspaceContext = {
  clerkUserId: "user-a",
  userPk: BigInt(7),
  companyId: BigInt(5),
  role: "editor",
  status: "verified",
};

function postRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const OWNED_DOCUMENT = [{ id: 42 }];

describe("note target relationships", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueuedRows = [];
    mockSelectCount.value = 0;
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
      success: true,
      data: CTX,
    });
    mockInsert.mockReturnValue({
      values: () => ({
        returning: () =>
          Promise.resolve([{ id: 1, companyId: "5", contentRich: null }]),
      }),
    });
    (captureFromSelection as jest.Mock).mockResolvedValue({
      markdown: "captured",
      suggestedTitle: "Title",
    });
  });

  describe("POST /api/notes", () => {
    it("rejects a document owned by another workspace", async () => {
      mockQueuedRows = [[]];

      const response = await createNote(
        postRequest("http://localhost/api/notes", {
          documentId: "42",
          title: "note",
        }),
      );

      expect(response.status).toBe(404);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects a version that belongs to a different document", async () => {
      mockQueuedRows = [OWNED_DOCUMENT, []];

      const response = await createNote(
        postRequest("http://localhost/api/notes", {
          documentId: "42",
          versionId: 99,
          title: "note",
        }),
      );

      expect(response.status).toBe(404);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects a version supplied without a document", async () => {
      const response = await createNote(
        postRequest("http://localhost/api/notes", {
          versionId: 99,
          title: "note",
        }),
      );

      expect(response.status).toBe(400);
      expect(mockSelectCount.value).toBe(0);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("accepts a matching document and version", async () => {
      mockQueuedRows = [OWNED_DOCUMENT, [{ id: 99 }]];

      const response = await createNote(
        postRequest("http://localhost/api/notes", {
          documentId: "42",
          versionId: 99,
          title: "note",
        }),
      );

      expect(response.status).toBe(201);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("accepts a freeform note with no target", async () => {
      const response = await createNote(
        postRequest("http://localhost/api/notes", { title: "note" }),
      );

      expect(response.status).toBe(201);
      expect(mockSelectCount.value).toBe(0);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/notes/ai-capture", () => {
    it("rejects a document owned by another workspace before the LLM call", async () => {
      mockQueuedRows = [[]];

      const response = await aiCapture(
        postRequest("http://localhost/api/notes/ai-capture", {
          selection: "some text",
          intent: "summary",
          sourceContext: { documentId: "42" },
        }),
      );

      expect(response.status).toBe(404);
      expect(captureFromSelection).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects a version that belongs to a different document", async () => {
      mockQueuedRows = [OWNED_DOCUMENT, []];

      const response = await aiCapture(
        postRequest("http://localhost/api/notes/ai-capture", {
          selection: "some text",
          intent: "summary",
          sourceContext: { documentId: "42", versionId: 99 },
        }),
      );

      expect(response.status).toBe(404);
      expect(captureFromSelection).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("captures against a document in the active workspace", async () => {
      mockQueuedRows = [OWNED_DOCUMENT];

      const response = await aiCapture(
        postRequest("http://localhost/api/notes/ai-capture", {
          selection: "some text",
          intent: "summary",
          sourceContext: { documentId: "42" },
        }),
      );

      expect(response.status).toBe(201);
      expect(captureFromSelection).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });
});
