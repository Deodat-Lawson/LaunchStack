/** @jest-environment node */

jest.mock("~/server/storage/deletion/plan", () => ({ planDocumentDeletion: jest.fn() }));
jest.mock("~/server/services/connectors/deleted-items", () => ({
    rememberDeletedSource: jest.fn(),
}));
jest.mock("~/server/db/schema", () => ({
    ChatHistory: {},
    documentReferenceResolution: {},
    documentViews: {},
    googleDrivePickedItem: {},
    predictiveDocumentAnalysisResults: {},
}));
import { deleteDocumentCore } from "~/server/services/document-delete";
import { planDocumentDeletion } from "~/server/storage/deletion/plan";

const context = { requestedBy: "user1", reason: "user_delete", traceId: "trace-delete" };
const mockDelete = jest.fn();
const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    delete: () => ({ where: mockDelete }),
};
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(planDocumentDeletion).mockResolvedValue([1]);
    mockDelete.mockResolvedValue(undefined);
});
it("snapshots all storage before removing any relational children using the caller transaction", async () => {
    await deleteDocumentCore(tx as never, 7, context);
    expect(planDocumentDeletion).toHaveBeenCalledWith(tx, { documentIds: [7], ...context });
    expect(mockDelete).toHaveBeenCalled();
    expect(jest.mocked(planDocumentDeletion).mock.invocationCallOrder[0]).toBeLessThan(
        mockDelete.mock.invocationCallOrder[0]!
    );
});
it("leaves relational data alone when durable planning fails", async () => {
    jest.mocked(planDocumentDeletion).mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(deleteDocumentCore(tx as never, 7, context)).rejects.toThrow("outbox unavailable");
    expect(mockDelete).not.toHaveBeenCalled();
});
