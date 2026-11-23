jest.mock("~/server/vantage/legacy-read-authority", () => ({
    authorizeLegacyAgendaRead: jest.fn(),
}));
jest.mock("~/app/api/vantage/_http", () => ({
    vantageContext: jest.fn(async () => ({
        ok: true,
        ctx: { companyId: 1n, userId: "u", can: () => true },
    })),
    json: (body: unknown) => Response.json(body),
    error: (message: string, status: number) => Response.json({ error: message }, { status }),
    handleVantageError: (_scope: string, error: { status: number }) =>
        Response.json({ error: "Forbidden" }, { status: error.status }),
    say: () => "not found",
}));
jest.mock("~/app/api/vantage/_schemas", () => ({ AgendaStatusSchema: {} }));
jest.mock("@launchstack/pipelines/vantage", () => ({ getAgenda: jest.fn() }));
import { GET } from "~/app/api/vantage/agendas/[id]/route";
import { getAgenda } from "@launchstack/pipelines/vantage";
import { authorizeLegacyAgendaRead } from "~/server/vantage/legacy-read-authority";
import { NextRequest } from "next/server";
describe("legacy agenda HTTP response authorization", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(getAgenda).mockResolvedValue({
            id: "a",
            summary: "private report",
            topics: [],
        } as never);
    });
    it("does not serialize a denied report", async () => {
        jest.mocked(authorizeLegacyAgendaRead).mockRejectedValueOnce(
            Object.assign(Error("denied"), { status: 403 })
        );
        const response = await GET(new NextRequest("http://localhost/api/vantage/agendas/a"), {
            params: Promise.resolve({ id: "a" }),
        });
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain("private report");
    });
    it("returns the unmodified historical body after authorization", async () => {
        jest.mocked(authorizeLegacyAgendaRead).mockResolvedValueOnce(undefined);
        const response = await GET(new NextRequest("http://localhost/api/vantage/agendas/a"), {
            params: Promise.resolve({ id: "a" }),
        });
        expect(response.status).toBe(200);
        expect((await response.json()).agenda.summary).toBe("private report");
    });
});
