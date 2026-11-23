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
jest.mock("@launchstack/pipelines/vantage", () => ({
    defaultAgendaWeek: () => "2026-11-23",
    getAgenda: jest.fn(),
    getAgendaByWeek: jest.fn(),
    listAgendas: jest.fn(),
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));
import { GET, DELETE } from "~/app/api/vantage/agendas/[id]/route";
import { GET as list } from "~/app/api/vantage/agendas/route";
import {
    getAgenda,
    getAgendaByWeek,
    listAgendas,
    VantageError,
} from "@launchstack/pipelines/vantage";
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
    it("retains an authorized agenda rather than deleting it", async () => {
        jest.mocked(authorizeLegacyAgendaRead).mockResolvedValueOnce(undefined);
        const response = await DELETE(new NextRequest("http://localhost/api/vantage/agendas/a"), {
            params: Promise.resolve({ id: "a" }),
        });
        expect(response.status).toBe(409);
        expect(authorizeLegacyAgendaRead).toHaveBeenCalled();
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

it("returns older authorized agendas when denied reports fill the first page", async () => {
    const firstPage = Array.from({ length: 26 }, (_, i) => ({
        id: `recent-${i}`,
        weekStart: `recent-week-${i}`,
        summary: "private recent summary",
    }));
    const older = { id: "older", weekStart: "older-week" };
    jest.mocked(listAgendas)
        .mockResolvedValueOnce(firstPage as never)
        .mockResolvedValueOnce([older] as never);
    jest.mocked(getAgendaByWeek).mockResolvedValue({ id: "selected" } as never);
    jest.mocked(getAgenda).mockImplementation(async ({ id }) => ({ id }) as never);
    jest.mocked(authorizeLegacyAgendaRead).mockImplementation(async (_ctx, agenda) => {
        if (agenda?.id !== "older")
            throw new VantageError("denied", 403, "legacy_report_forbidden");
    });

    const result = await list(new NextRequest("http://localhost/api/vantage/agendas"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
        week: "2026-11-23",
        agenda: null,
        agendas: [older],
    });
    expect(listAgendas).toHaveBeenNthCalledWith(2, {
        companyId: 1n,
        creatorUserId: "u",
        beforeWeek: "recent-week-25",
        limit: 26,
    });
});
