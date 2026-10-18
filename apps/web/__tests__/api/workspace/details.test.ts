/**
 * Workspace › General: the workspace's own details. What must not regress:
 * everyone may read them, only `settings.manage` changes them, a URL another
 * workspace holds is refused (the workspace's own is not "taken"), bad input
 * never reaches the table, and every change is audited from → to.
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
const mockContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockContext())
);

import { company } from "@launchstack/store/schema";

import { GET, PATCH } from "~/app/api/workspace/details/route";
import { workspaceAuditEvents } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { jsonRequest } from "./_setup";

const ROW = {
    id: 5,
    name: "Northwind",
    slug: "northwind",
    description: null,
    industry: null,
    numberOfEmployees: "2–5 people",
    swatch: 1,
};

const as = (role: string) =>
    mockContext.mockReturnValue({ success: true, data: makeWorkspaceContext({ role }) });

const patch = (body: unknown) => PATCH(jsonRequest("/api/workspace/details", "PATCH", body));

beforeEach(() => {
    fakeDb.reset();
    mockContext.mockReset();
    as("owner");
});

describe("GET /api/workspace/details", () => {
    it("tells any member what the workspace is called, and that they may not change it", async () => {
        as("member");
        fakeDb.onSelect(company, [ROW]);

        const res = await GET();

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            workspace: {
                id: 5,
                name: "Northwind",
                slug: "northwind",
                description: null,
                industry: null,
                teamSize: "2–5 people",
                swatch: 1,
            },
            canEdit: false,
        });
    });

    it("says an admin may change them", async () => {
        as("admin");
        fakeDb.onSelect(company, [ROW]);
        await expect((await GET()).json()).resolves.toMatchObject({ canEdit: true });
    });

    it("answers for nobody outside the workspace", async () => {
        mockContext.mockReturnValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        expect((await GET()).status).toBe(401);
    });
});

describe("PATCH /api/workspace/details", () => {
    it("refuses a member without settings.manage, before reading anything", async () => {
        as("member");
        const res = await patch({ name: "Elsewhere" });

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({ permission: "settings.manage" });
        expect(fakeDb.updatesOf(company)).toEqual([]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([]);
    });

    it.each([
        ["an empty name", { name: "   " }],
        ["a slug with capitals and spaces left after lowering", { slug: "north wind" }],
        ["a one-letter slug", { slug: "n" }],
        ["a seventh colour", { swatch: 7 }],
        ["a field it does not own", { embeddingIndexKey: "x" }],
        ["nothing at all", {}],
        ["a name past 120 characters", { name: "x".repeat(121) }],
    ])("rejects %s", async (_label, body) => {
        fakeDb.onSelect(company, [ROW]);
        const res = await patch(body);

        expect(res.status).toBe(400);
        expect(fakeDb.updatesOf(company)).toEqual([]);
    });

    it("renames the workspace and audits what it was and what it became", async () => {
        fakeDb.onSelect(company, [ROW]);
        const res = await patch({ name: "  Northwind Labs ", swatch: 3 });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            workspace: expect.objectContaining({ name: "Northwind Labs", swatch: 3 }),
        });
        expect(fakeDb.updatesOf(company)).toEqual([{ name: "Northwind Labs", swatch: 3 }]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                companyId: 5n,
                actorUserId: "user-a",
                action: "settings.changed",
                targetType: "workspace",
                targetId: "5",
                detail: {
                    changes: {
                        name: { from: "Northwind", to: "Northwind Labs" },
                        swatch: { from: 1, to: 3 },
                    },
                },
            }),
        ]);
    });

    it("stores the team size in the column the create form fills, and clears an emptied description", async () => {
        fakeDb.onSelect(company, [{ ...ROW, description: "We make maps." }]);
        const res = await patch({
            teamSize: "6–20 people",
            description: "",
            industry: "Logistics",
        });

        expect(res.status).toBe(200);
        expect(fakeDb.updatesOf(company)).toEqual([
            { description: null, industry: "Logistics", numberOfEmployees: "6–20 people" },
        ]);
    });

    it("refuses a URL another workspace holds, naming the field", async () => {
        // First read: this workspace. Second: who holds the slug.
        fakeDb.onSelect(company, [ROW], [{ id: 9 }]);
        const res = await patch({ slug: "acme" });

        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toMatchObject({ field: "slug" });
        expect(fakeDb.updatesOf(company)).toEqual([]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([]);
    });

    it("lowers a new URL, and doesn't count its own workspace as taking it", async () => {
        fakeDb.onSelect(company, [ROW], [{ id: 5 }]);
        const res = await patch({ slug: "Northwind-Labs" });

        expect(res.status).toBe(200);
        expect(fakeDb.updatesOf(company)).toEqual([{ slug: "northwind-labs" }]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)[0]).toMatchObject({
            detail: { changes: { slug: { from: "northwind", to: "northwind-labs" } } },
        });
    });

    it("writes and audits nothing when nothing changed", async () => {
        fakeDb.onSelect(company, [ROW]);
        const res = await patch({ name: "Northwind", slug: "northwind" });

        expect(res.status).toBe(200);
        expect(fakeDb.updatesOf(company)).toEqual([]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([]);
    });

    it("says so when the workspace is gone", async () => {
        fakeDb.onSelect(company, []);
        expect((await patch({ name: "Ghost" })).status).toBe(404);
    });
});
