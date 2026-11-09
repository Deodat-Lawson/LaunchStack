jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/server/history", () => ({ deleteHistoryEntry: jest.fn() }));
jest.mock("~/i18n/server", () => ({ requestTranslator: () => (key: string) => key }));
jest.mock("~/lib/validation", () => ({ serverError: jest.fn() }));
import { DELETE } from "~/app/api/workspace/history/[kind]/[refId]/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { deleteHistoryEntry } from "~/server/history";
describe("generated review history deletion", () => {
    beforeEach(() => jest.clearAllMocks());
    it.each(["weekly-review", "vantage"])("denies a read-only member deleting %s", async kind => {
        jest.mocked(requireWorkspaceContext).mockResolvedValue({
            success: true,
            data: { can: () => false },
        } as never);
        const response = await DELETE(new Request("http://localhost"), {
            params: Promise.resolve({ kind, refId: "known" }),
        });
        expect(response.status).toBe(403);
        expect(deleteHistoryEntry).not.toHaveBeenCalled();
    });
    it("retains audit records even for a mutating member", async () => {
        jest.mocked(requireWorkspaceContext).mockResolvedValue({
            success: true,
            data: { can: () => true },
        } as never);
        const response = await DELETE(new Request("http://localhost"), {
            params: Promise.resolve({ kind: "weekly-review", refId: "known" }),
        });
        expect(response.status).toBe(409);
        expect(deleteHistoryEntry).not.toHaveBeenCalled();
    });
});
