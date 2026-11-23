jest.mock("~/server/db", () => ({ db: { select: jest.fn() } }));
jest.mock("~/server/db/schema", () => ({
    vantageAgendas: {
        id: "id",
        companyId: "company",
        createdByUserId: "creator",
        weekStart: "week",
    },
}));
jest.mock("@launchstack/pipelines/vantage", () => ({
    getAgenda: jest.fn(),
    VantageError: class VantageError extends Error {
        status: number;
        code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));
jest.mock("~/server/vantage/legacy-read-authority", () => ({
    authorizeLegacyAgendaRead: jest.fn(),
}));
import { db } from "~/server/db";
import { getAgenda, VantageError } from "@launchstack/pipelines/vantage";
import { authorizeLegacyAgendaRead } from "~/server/vantage/legacy-read-authority";
import { PIPELINE_LOADERS } from "~/server/history/loaders";
const loader = PIPELINE_LOADERS.find(loader => loader.kind === "vantage")!;
const ctx = { companyId: 1n, userId: "owner", can: () => true, limit: 10 };
beforeEach(() => {
    jest.clearAllMocks();
    const rows = [
        {
            id: "a",
            weekStart: "2026-11-16",
            status: "held",
            summary: "protected text",
            createdAt: new Date("2026-11-16"),
        },
    ];
    const query = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn(async () => rows),
    };
    jest.mocked(db.select).mockReturnValue(query as never);
    jest.mocked(getAgenda).mockResolvedValue({ id: "a", topics: [] } as never);
    jest.mocked(authorizeLegacyAgendaRead).mockResolvedValue(undefined);
});
it("does not query without current read capability", async () => {
    expect(await loader.load({ ...ctx, can: () => false })).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
});
it("authorizes the full agenda before returning its summary, with no unsupported open or removal", async () => {
    const result = await loader.load(ctx);
    expect(authorizeLegacyAgendaRead).toHaveBeenCalledWith(
        { companyId: 1n, userId: "owner", can: ctx.can },
        { id: "a", topics: [] }
    );
    expect(result[0]).toMatchObject({ subtitle: "protected text" });
    expect(result[0]?.href).toBeUndefined();
    expect(loader.remove).toBeUndefined();
});
it("withholds summaries denied by creator, missing dependency or source policy", async () => {
    jest.mocked(authorizeLegacyAgendaRead).mockRejectedValue(
        new VantageError("denied", 403, "legacy_report_forbidden")
    );
    expect(await loader.load(ctx)).toEqual([]);
});
it("does not turn operational errors into authorized history", async () => {
    jest.mocked(authorizeLegacyAgendaRead).mockRejectedValue(new Error("store unavailable"));
    await expect(loader.load(ctx)).rejects.toThrow("store unavailable");
});
