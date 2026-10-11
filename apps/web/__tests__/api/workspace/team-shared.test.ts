/**
 * GET /api/workspace/team/people/[userPk]/shared — "what we share", both
 * directions, filtered to what the caller can open now (ADR-014 §7).
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/recording-db").recordingDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("~/server/sessions/access", () => ({
    readableSessionIds: jest.fn(async () => new Set<string>()),
}));

import { GET } from "~/app/api/workspace/team/people/[userPk]/shared/route";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { DocumentScope } from "~/lib/authz/scope-types";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    workspaceGroupMembers,
    workspaceSessionGrants,
} from "~/server/db/schema";
import { readableSessionIds } from "~/server/sessions/access";

import { fakeDb } from "../../helpers/fake-db";
import { recordingDb } from "../../helpers/recording-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const readable = readableSessionIds as jest.Mock;

/** The caller: Ada, users.id 7, in Sales (group 3). */
const ADA = { role: "member", authUserId: "user-a", userPk: 7n } as const;
/** The person whose page it is: Ben, users.id 8, in Design (group 4). */
const BEN_AUTH = "user-b";

const T1 = new Date("2026-10-01T10:00:00Z");
const T2 = new Date("2026-10-05T10:00:00Z");
const T3 = new Date("2026-10-09T10:00:00Z");

function as(scope?: DocumentScope) {
    gate.mockImplementation(gateFor(makeWorkspaceContext({ ...ADA, scope })));
}

function seedPeople() {
    fakeDb.onSelect(userCompanyMemberships, [{ authUserId: BEN_AUTH }]);
    fakeDb.onSelect(workspaceGroupMembers, [
        { userId: 7n, groupId: 3, name: "Sales" },
        { userId: 8n, groupId: 4, name: "Design" },
    ]);
}

function get(userPk = "8") {
    return GET(
        jsonRequest(`/api/workspace/team/people/${userPk}/shared`, "GET"),
        params({ userPk })
    );
}

type Body = {
    sharedWithMe: Record<string, unknown>[];
    iShared: Record<string, unknown>[];
};

beforeEach(() => {
    recordingDb.reset();
    jest.clearAllMocks();
    as();
    readable.mockImplementation(async (_ctx: unknown, ids: string[]) => new Set(ids));
});

describe("GET /api/workspace/team/people/[userPk]/shared", () => {
    it("lists what Ben shared with Ada and what Ada shared with Ben", async () => {
        seedPeople();
        // Ben → Ada: a folder through Sales, a file both directly and through Sales.
        // Ada → Ben: a chat directly.
        fakeDb.onSelect(
            folderGrants,
            [
                {
                    id: 11,
                    name: "Finance",
                    principalType: "group",
                    principalId: "3",
                    level: "edit",
                    at: T2,
                },
            ],
            []
        );
        fakeDb.onSelect(
            documentGrants,
            [
                {
                    id: 42,
                    title: "Q3 plan.pdf",
                    category: "Board",
                    principalType: "group",
                    principalId: "3",
                    level: "view",
                    at: T1,
                },
                {
                    id: 42,
                    title: "Q3 plan.pdf",
                    category: "Board",
                    principalType: "user",
                    principalId: "7",
                    level: "edit",
                    at: T3,
                },
            ],
            []
        );
        fakeDb.onSelect(
            workspaceSessionGrants,
            [],
            [
                {
                    id: "s1",
                    title: "Pricing",
                    principalType: "user",
                    principalId: "8",
                    level: "view",
                    at: T2,
                },
            ]
        );

        const res = await get();

        expect(res.status).toBe(200);
        const body = (await res.json()) as Body;
        expect(body.sharedWithMe).toEqual([
            {
                type: "document",
                id: 42,
                name: "Q3 plan.pdf",
                path: "Board",
                level: "edit",
                at: T3.toISOString(),
            },
            {
                type: "folder",
                id: 11,
                name: "Finance",
                path: "Finance",
                level: "edit",
                at: T2.toISOString(),
                viaGroup: "Sales",
            },
        ]);
        expect(body.iShared).toEqual([
            { type: "chat", id: "s1", name: "Pricing", level: "view", at: T2.toISOString() },
        ]);
    });

    it("asks for grants the other person added that reach the caller, then the reverse", async () => {
        seedPeople();

        await get();

        for (const table of [folderGrants, documentGrants, workspaceSessionGrants]) {
            const [toMe, fromMe] = recordingDb.wheres(table);
            // Ben's grants reaching Ada (user 7, or her group 3).
            expect(toMe!.sql).toMatch(/"granted_by" = \$\d/);
            expect(toMe!.sql).toMatch(/"principal_type" = \$\d and .*"principal_id" = \$\d/);
            expect(toMe!.sql).toMatch(/"principal_id" in \(\$\d\)/);
            expect(toMe!.params).toEqual(
                expect.arrayContaining([5n, BEN_AUTH, "user", "7", "group", "3"])
            );
            expect(toMe!.params).not.toContain("8");
            // Ada's grants reaching Ben (user 8, or his group 4).
            expect(fromMe!.params).toEqual(
                expect.arrayContaining([5n, "user-a", "user", "8", "group", "4"])
            );
            expect(fromMe!.params).not.toContain("7");
        }
    });

    it("keeps only what the caller can open now", async () => {
        as({
            kind: "except",
            deniedCategories: ["Finance"],
            deniedDocumentIds: [],
            allowedDocumentIds: [43],
        });
        seedPeople();
        fakeDb.onSelect(
            folderGrants,
            [
                {
                    id: 11,
                    name: "Finance",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
                {
                    id: 12,
                    name: "Board",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
            ],
            []
        );
        fakeDb.onSelect(
            documentGrants,
            [
                {
                    id: 42,
                    title: "Hidden.pdf",
                    category: "Finance",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
                {
                    id: 43,
                    title: "Granted.pdf",
                    category: "Finance",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
            ],
            []
        );
        fakeDb.onSelect(
            workspaceSessionGrants,
            [
                {
                    id: "s1",
                    title: "Open",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
                {
                    id: "s2",
                    title: "Gone",
                    principalType: "user",
                    principalId: "7",
                    level: "view",
                    at: T1,
                },
            ],
            []
        );
        readable.mockImplementation(async () => new Set(["s1"]));

        const body = (await (await get()).json()) as Body;

        expect(body.sharedWithMe.map(i => `${String(i.type)}:${String(i.name)}`).sort()).toEqual([
            "chat:Open",
            "document:Granted.pdf",
            "folder:Board",
        ]);
    });

    it("is empty on your own page", async () => {
        fakeDb.onSelect(userCompanyMemberships, [{ authUserId: "user-a" }]);
        const res = await get("7");
        await expect(res.json()).resolves.toEqual({ sharedWithMe: [], iShared: [] });
        expect(recordingDb.wheres(folderGrants)).toHaveLength(0);
    });

    it("answers 404 for someone outside the workspace", async () => {
        fakeDb.onSelect(userCompanyMemberships, []);
        expect((await get()).status).toBe(404);
    });

    it("answers 400 for a malformed id", async () => {
        expect((await get("abc")).status).toBe(400);
    });

    it("needs members.view, so a Guest gets 403", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "guest" })));
        expect((await get()).status).toBe(403);
    });
});
