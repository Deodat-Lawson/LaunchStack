jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));

import { POST } from "~/app/api/signup/join/route";
import { getServerSession } from "~/server/auth";
import { inviteCodes, userCompanyMemberships, users } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";

const session = getServerSession as jest.Mock;

function request(body: unknown): Request {
    return new Request("http://localhost/api/signup/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
});

describe("POST /api/signup/join (alias of join-links/accept)", () => {
    it("joins an already-registered account as a pending member of a second workspace", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "amy@example.com", name: "Amy" },
        });
        fakeDb.onSelect(inviteCodes, [
            {
                id: 3,
                code: "ABCD1234",
                companyId: 9n,
                role: "employee",
                isActive: true,
                createdBy: "user-a",
                createdAt: new Date(),
                expiresAt: null,
                maxUses: null,
                useCount: 4,
            },
        ]);
        fakeDb.onSelect(users, [{ id: 12 }]);
        fakeDb.onSelect(userCompanyMemberships, []);

        const res = await POST(
            request({ name: "Amy", email: "amy@example.com", inviteCode: "abcd1234" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            success: true,
            status: "pending",
            companyId: 9,
            redirectTo: "/employer/pending-approval",
            alreadyMember: false,
        });
        expect(fakeDb.insertedInto(users)).toHaveLength(0);
        expect(fakeDb.insertedInto(userCompanyMemberships)).toEqual([
            { userId: 12n, companyId: 9n, role: "member", status: "pending" },
        ]);
        expect(res.cookies.get("pdr_active_company")?.value).toBe("9");
    });

    it("answers 401 without a session", async () => {
        session.mockResolvedValue(null);
        const res = await POST(request({ name: "Amy", email: "amy@example.com", inviteCode: "X" }));
        expect(res.status).toBe(401);
    });

    it("answers 404 for an unknown code", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "amy@example.com", name: "Amy" },
        });
        const res = await POST(
            request({ name: "Amy", email: "amy@example.com", inviteCode: "NOPE" })
        );
        expect(res.status).toBe(404);
    });
});
