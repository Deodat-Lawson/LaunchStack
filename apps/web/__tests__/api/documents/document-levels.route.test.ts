/**
 * ADR-014 §3 on the document write paths: a role permission lets you try, the
 * level on the file decides. Someone who can only view a file cannot rename,
 * move or delete it; someone who can edit it can, and a move also needs edit
 * access to the folder it goes into. A move reports what happened to the
 * file's audience, and every change lands in the activity feed — a deleted
 * file's name only for everyone when everyone could see it.
 *
 * The level rules themselves are pure and pinned in item-access.test; here
 * the routes are, given an answer.
 */

import type { NextResponse } from "next/server";

import { DELETE as deleteDocument } from "~/app/api/deleteDocument/route";
import { DELETE as batchDelete } from "~/app/api/documents/batchDelete/route";
import { PATCH } from "~/app/api/documents/[id]/route";
import { document } from "@launchstack/store/schema";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { canEditFolder } from "~/server/services/folder-access";
import { recordActivity } from "~/server/workspace/activity";
import {
    canEditDocument,
    documentAccess,
    type AudienceKind,
    type ItemAccess,
} from "~/server/workspace/item-access";
import { applyDocumentMoveDefaults } from "~/server/workspace/ownership";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/db", () => ({ db: jest.requireActual("../../helpers/fake-db").fakeDb.db }));
jest.mock("~/server/db/index", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => ({ op: "scoped" }) }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/server/services/document-delete", () => ({ deleteDocumentCore: jest.fn() }));
jest.mock("~/server/company-profile/service", () => ({ reassembleAfterDelete: jest.fn() }));
jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    DOCUMENT_EDIT_DENIED: "You can view this file but not change it.",
    DOCUMENT_DELETE_DENIED:
        "Only the person who added this file, or someone who manages it, can delete it.",
    canEditFolder: jest.fn(),
}));
jest.mock("~/server/workspace/item-access", () => ({
    accessSubject: jest.fn().mockResolvedValue({ userPk: "7" }),
    canDeleteAtLevel: jest.requireActual("~/server/workspace/item-access").canDeleteAtLevel,
    canEditDocument: jest.fn(),
    documentAccess: jest.fn(),
    levelAtLeast: (level: string | null, required: string) => {
        const rank = { view: 1, edit: 2, manage: 3 } as Record<string, number>;
        return level !== null && (rank[level] ?? 0) >= (rank[required] ?? 99);
    },
}));
jest.mock("~/server/workspace/ownership", () => ({ applyDocumentMoveDefaults: jest.fn() }));
jest.mock("~/server/workspace/activity", () => ({ recordActivity: jest.fn() }));

const member = makeWorkspaceContext({
    authUserId: "ada",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "member",
});

// Deleting takes `documents.delete`, which Members do not hold; an Admin does,
// and since ADR-014 that buys no level on a file by itself.
const admin = makeWorkspaceContext({
    authUserId: "ada",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "admin",
});

const ROW = { id: 12, title: "Q3 plan.pdf", category: "Sales", companyId: BigInt(5) };

function patch(body: unknown): Promise<Response> {
    return PATCH(
        new Request("http://localhost/api/documents/12", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: "12" }) }
    );
}

function del(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const access = (
    level: "view" | "edit" | "manage" | null,
    audience: AudienceKind = "workspace"
): ItemAccess => ({
    visible: level !== null,
    level,
    audience,
    governingPath: null,
    ownAudience: false,
    principalCount: 0,
});

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
    fakeDb.onSelect(document, [ROW]);
    jest.mocked(canEditFolder).mockResolvedValue(true);
});

describe("PATCH /api/documents/[id] — rename and move", () => {
    it("refuses a rename from someone who can only view the file", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(false);

        const response = await patch({ title: "Renamed" });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "You can view this file but not change it.",
        });
        expect(canEditDocument).toHaveBeenCalledWith(member, { id: 12, category: "Sales" });
        expect(fakeDb.updatesOf(document)).toHaveLength(0);
        expect(recordActivity).not.toHaveBeenCalled();
    });

    it("refuses a move from someone who can only view the file", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(false);

        const response = await patch({ category: "Unfiled" });

        expect(response.status).toBe(403);
        expect(fakeDb.updatesOf(document)).toHaveLength(0);
        expect(applyDocumentMoveDefaults).not.toHaveBeenCalled();
    });

    it("renames for someone who can edit it, and says so in the feed", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(true);
        fakeDb.onReturning(document, [{ ...ROW, title: "Renamed", currentVersionId: null }]);

        const response = await patch({ title: "Renamed" });
        const body = (await response.json()) as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(fakeDb.updatesOf(document)).toEqual([{ title: "Renamed" }]);
        expect(body.move).toBeUndefined();
        expect(recordActivity).toHaveBeenCalledTimes(1);
        expect(recordActivity).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                verb: "renamed",
                targetType: "document",
                targetId: 12,
                targetLabel: "Renamed",
                detail: { from: "Q3 plan.pdf", to: "Renamed" },
            })
        );
    });

    it("needs edit access to the destination folder too", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(true);
        jest.mocked(canEditFolder).mockResolvedValue(false);

        const response = await patch({ category: "Board" });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "You do not have edit access to this folder.",
        });
        expect(canEditFolder).toHaveBeenCalledWith(member, "Board");
        expect(fakeDb.updatesOf(document)).toHaveLength(0);
    });

    it("moves, applies Drive's rule to its audience, and returns what happened", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(true);
        jest.mocked(applyDocumentMoveDefaults).mockResolvedValue("inherits_folder");
        fakeDb.onReturning(document, [{ ...ROW, category: "Marketing", currentVersionId: null }]);

        const response = await patch({ category: "Marketing" });
        const body = (await response.json()) as { move?: unknown };

        expect(response.status).toBe(200);
        expect(applyDocumentMoveDefaults).toHaveBeenCalledWith(
            expect.anything(),
            { companyId: BigInt(5), userPk: BigInt(7), authUserId: "ada" },
            { id: 12, fromCategory: "Sales", toCategory: "Marketing" }
        );
        expect(body.move).toEqual({ from: "Sales", to: "Marketing", access: "inherits_folder" });
        expect(recordActivity).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                verb: "moved",
                targetPath: "Marketing",
                detail: { from: "Sales", to: "Marketing", access: "inherits_folder" },
            })
        );
    });

    it("does not count staying put as a move", async () => {
        jest.mocked(canEditDocument).mockResolvedValue(true);
        fakeDb.onReturning(document, [{ ...ROW, currentVersionId: null }]);

        const response = await patch({ category: "Sales" });

        expect(response.status).toBe(200);
        expect(canEditFolder).not.toHaveBeenCalled();
        expect(applyDocumentMoveDefaults).not.toHaveBeenCalled();
        expect(recordActivity).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/deleteDocument", () => {
    beforeEach(() => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: admin });
    });

    it("refuses someone who can only view the file", async () => {
        jest.mocked(documentAccess).mockResolvedValue(access("view"));

        const response = await deleteDocument(del("/api/deleteDocument", { docId: "12" }));

        expect(response.status).toBe(403);
        expect(deleteDocumentCore).not.toHaveBeenCalled();
        expect(recordActivity).not.toHaveBeenCalled();
    });

    it("deletes for an editor and tells the team only when everyone could see it", async () => {
        jest.mocked(documentAccess).mockResolvedValue(access("edit", "workspace"));

        const response = await deleteDocument(del("/api/deleteDocument", { docId: "12" }));

        expect(response.status).toBe(200);
        expect(deleteDocumentCore).toHaveBeenCalledWith(expect.anything(), 12);
        expect(recordActivity).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                verb: "deleted",
                targetId: 12,
                targetLabel: "Q3 plan.pdf",
                detail: { wasWorkspace: true },
            })
        );
    });

    it("keeps a private file's deletion out of everyone else's feed", async () => {
        jest.mocked(documentAccess).mockResolvedValue(access("manage", "private"));

        await deleteDocument(del("/api/deleteDocument", { docId: "12" }));

        expect(recordActivity).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ detail: { wasWorkspace: false } })
        );
    });
});

describe("DELETE /api/deleteDocument — who may throw a file away", () => {
    it("lets a Member delete a file they manage (their own upload) without documents.delete", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
        jest.mocked(documentAccess).mockResolvedValue(access("manage", "private"));

        const response = await deleteDocument(del("/api/deleteDocument", { docId: "12" }));

        expect(response.status).toBe(200);
        expect(deleteDocumentCore).toHaveBeenCalledWith(expect.anything(), 12);
    });

    it("refuses a Member who can edit a teammate's file but does not manage it", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
        jest.mocked(documentAccess).mockResolvedValue(access("edit", "workspace"));

        const response = await deleteDocument(del("/api/deleteDocument", { docId: "12" }));

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            error: "Only the person who added this file, or someone who manages it, can delete it.",
        });
        expect(deleteDocumentCore).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/documents/batchDelete", () => {
    beforeEach(() => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: admin });
    });

    it("refuses the whole batch when one file is view-only", async () => {
        fakeDb.reset();
        fakeDb.onSelect(document, [ROW, { ...ROW, id: 13, title: "Board.pdf" }]);
        jest.mocked(documentAccess)
            .mockResolvedValueOnce(access("edit"))
            .mockResolvedValueOnce(access("view"));

        const response = await batchDelete(del("/api/documents/batchDelete", { docIds: [12, 13] }));

        expect(response.status).toBe(403);
        expect(deleteDocumentCore).not.toHaveBeenCalled();
    });

    it("deletes every file the caller may edit and records each", async () => {
        fakeDb.reset();
        fakeDb.onSelect(document, [ROW, { ...ROW, id: 13, title: "Board.pdf" }]);
        jest.mocked(documentAccess)
            .mockResolvedValueOnce(access("edit", "workspace"))
            .mockResolvedValueOnce(access("manage", "shared"));

        const response = await batchDelete(del("/api/documents/batchDelete", { docIds: [12, 13] }));

        expect(response.status).toBe(200);
        expect(deleteDocumentCore).toHaveBeenCalledTimes(2);
        expect(jest.mocked(recordActivity).mock.calls.map(([, input]) => input.detail)).toEqual([
            { wasWorkspace: true },
            { wasWorkspace: false },
        ]);
    });
});
