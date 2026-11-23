jest.mock("~/app/api/vantage/agendas/[id]/route", () => ({ DELETE: jest.fn() }));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(async () => ({
        success: true,
        data: { companyId: 1n, authUserId: "owner" },
    })),
}));
jest.mock("~/server/history", () => ({ deleteHistoryEntry: jest.fn() }));
import { DELETE } from "~/app/api/workspace/history/[kind]/[refId]/route";
import { DELETE as deleteLegacyAgenda } from "~/app/api/vantage/agendas/[id]/route";
import { deleteHistoryEntry } from "~/server/history";
it.each([403, 404, 409])(
    "generic Vantage delete preserves direct authority/retention response %s",
    async status => {
        jest.mocked(deleteLegacyAgenda).mockResolvedValue(
            Response.json({ code: "protected" }, { status }) as never
        );
        const response = await DELETE(
            new Request("http://localhost/api/workspace/history/vantage/a"),
            { params: Promise.resolve({ kind: "vantage", refId: "a" }) }
        );
        expect(response.status).toBe(status);
        expect(deleteLegacyAgenda).toHaveBeenLastCalledWith(expect.any(Request), {
            params: expect.any(Promise),
        });
        expect(deleteHistoryEntry).not.toHaveBeenCalled();
    }
);
