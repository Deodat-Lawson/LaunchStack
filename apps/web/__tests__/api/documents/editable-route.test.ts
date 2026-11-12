/**
 * GET / PUT /api/documents/[id]/editable — the route's own duties: who may
 * open and save (the versions route's rule), the body it accepts, and that
 * every refusal is `{ error, message }` in the caller's language. What a
 * load or save does is the service's, tested in __tests__/file-editing.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET, PUT } from "~/app/api/documents/[id]/editable/route";
import { db } from "~/server/db";
import { FileEditError, loadEditable, saveEditable } from "~/server/services/file-editing/editable";
import { canEditDocument } from "~/server/workspace/item-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/server/workspace/item-access", () => ({
    canEditDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint) => ({ op: "scoped", companyId }),
}));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { standard: {}, permissive: {}, strict: {} },
}));
jest.mock("~/server/services/file-editing/editable", () => {
    class FileEditError extends Error {
        status: number;
        code: string;
        key: string;
        values: Record<string, string>;
        constructor(status: number, code: string, key: string, values = {}) {
            super(code);
            this.status = status;
            this.code = code;
            this.key = key;
            this.values = values;
        }
    }
    return {
        FileEditError,
        MAX_SAVE_BYTES: 1024,
        loadEditable: jest.fn(),
        saveEditable: jest.fn(),
    };
});
jest.mock("~/server/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@launchstack/store/schema", () => ({
    document: new Proxy({}, { get: (_t, prop) => `document.${String(prop)}` }),
}));
jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
}));

const mockSelect = db.select as jest.Mock;
const mockLoad = loadEditable as jest.Mock;
const mockSave = saveEditable as jest.Mock;
const mockCanEdit = canEditDocument as jest.Mock;

const ROW = {
    id: 55,
    companyId: BigInt(10),
    title: "Plan",
    category: "Strategy",
    url: "/api/files/9",
    mimeType: "text/markdown",
    fileType: "text/markdown",
    currentVersionId: BigInt(70),
    ocrMetadata: null,
};

function rows(found: unknown[]) {
    mockSelect.mockReturnValue({
        from: () => ({ where: jest.fn().mockResolvedValue(found) }),
    });
}

function signedIn(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "auth-1", companyId: BigInt(10), ...overrides }),
    });
}

const ctx = (id = "55") => ({ params: Promise.resolve({ id }) });

function get(headers: Record<string, string> = {}) {
    return new Request("https://app.test/api/documents/55/editable", { headers });
}

function put(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://app.test/api/documents/55/editable", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    signedIn();
    rows([ROW]);
    mockCanEdit.mockResolvedValue(true);
});

describe("GET /api/documents/[id]/editable", () => {
    it("loads the document and words its notice", async () => {
        mockLoad.mockResolvedValue({
            documentId: 55,
            title: "Plan",
            kind: "docx",
            mode: "rich",
            html: "<p>x</p>",
            text: "",
            base: "v:70",
            drive: null,
            noticeKey: "docxNotice",
        });

        const res = await GET(get(), ctx());
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(200);
        expect(body).toEqual({
            documentId: 55,
            title: "Plan",
            kind: "docx",
            mode: "rich",
            html: "<p>x</p>",
            text: "",
            base: "v:70",
            drive: null,
            notice: expect.stringContaining("The previous version stays in History."),
        });
        expect(mockLoad).toHaveBeenCalledWith(
            expect.objectContaining({ id: 55, companyId: BigInt(10), currentVersionId: BigInt(70) })
        );
    });

    it("words the notice in the caller's language", async () => {
        mockLoad.mockResolvedValue({ noticeKey: "driveNotice", base: "drive:v1" });
        const res = await GET(get({ cookie: "ls-locale=zh-CN.1" }), ctx());
        const body = (await res.json()) as { notice: string };
        expect(body.notice).toContain("Google 文档");
    });

    it("refuses a bad id", async () => {
        const res = await GET(get(), ctx("abc"));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "invalid_id" });
    });

    it("refuses someone without documents.upload", async () => {
        signedIn({ permissions: ["documents.read"] });
        const res = await GET(get(), ctx());
        expect(res.status).toBe(403);
        expect(mockLoad).not.toHaveBeenCalled();
    });

    it("reads a document out of scope like a missing one", async () => {
        rows([]);
        const res = await GET(get(), ctx());
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({
            error: "not_found",
            message: expect.stringContaining("could not be found"),
        });
    });

    it("refuses someone who may view but not edit the document", async () => {
        mockCanEdit.mockResolvedValue(false);
        const res = await GET(get(), ctx());
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
            error: "edit_denied",
            message: "You can view this file but not edit it.",
        });
        expect(mockLoad).not.toHaveBeenCalled();
    });

    it("passes the service's refusal through with its sentence", async () => {
        mockLoad.mockRejectedValue(new FileEditError(415, "not_editable", "notEditable"));
        const res = await GET(get(), ctx());
        expect(res.status).toBe(415);
        expect(await res.json()).toEqual({
            error: "not_editable",
            message: expect.stringContaining("Markdown, plain text and Word files can."),
        });
    });
});

describe("PUT /api/documents/[id]/editable", () => {
    it("saves and returns the new version and base", async () => {
        mockSave.mockResolvedValue({ versionId: 71, versionNumber: 2, base: "v:71" });

        const res = await PUT(put({ base: "v:70", html: "<p>new</p>" }), ctx());

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            success: true,
            versionId: 71,
            versionNumber: 2,
            base: "v:71",
        });
        expect(mockSave).toHaveBeenCalledWith({
            doc: expect.objectContaining({ id: 55 }),
            base: "v:70",
            html: "<p>new</p>",
            text: undefined,
            userId: "auth-1",
            requestUrl: "https://app.test/api/documents/55/editable",
        });
    });

    it.each([
        ["no base", { html: "<p>x</p>" }],
        ["both html and text", { base: "v:70", html: "<p>x</p>", text: "x" }],
        ["neither html nor text", { base: "v:70" }],
        ["not JSON", "{nope"],
    ])("refuses a body with %s", async (_label, body) => {
        const res = await PUT(put(body), ctx());
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "invalid" });
        expect(mockSave).not.toHaveBeenCalled();
    });

    it("refuses a body over the cap", async () => {
        const res = await PUT(put({ base: "v:70", html: "x".repeat(2000) }), ctx());
        expect(res.status).toBe(413);
        expect(await res.json()).toMatchObject({ error: "too_large" });
        expect(mockSave).not.toHaveBeenCalled();
    });

    it("refuses before reading when the declared length is over the cap", async () => {
        const res = await PUT(
            put({ base: "v:70", html: "x" }, { "content-length": "999999" }),
            ctx()
        );
        expect(res.status).toBe(413);
    });

    it("answers a stale save with 409 and the reason", async () => {
        mockSave.mockRejectedValue(
            new FileEditError(409, "changed_since_opened", "changedInGoogleDocs")
        );
        const res = await PUT(put({ base: "drive:v1", html: "<p>x</p>" }), ctx());
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: "changed_since_opened",
            message: expect.stringContaining("changed in Google Docs"),
        });
    });

    it("refuses someone who may view but not edit, before saving", async () => {
        mockCanEdit.mockResolvedValue(false);
        const res = await PUT(put({ base: "v:70", html: "<p>x</p>" }), ctx());
        expect(res.status).toBe(403);
        expect(mockSave).not.toHaveBeenCalled();
    });

    it("hides an unexpected failure behind a sentence", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockSave.mockRejectedValue(new Error("db down"));
        const res = await PUT(put({ base: "v:70", html: "<p>x</p>" }), ctx());
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
            error: "save_failed",
            message: "The file couldn't be saved. Try again.",
        });
        error.mockRestore();
    });
});
