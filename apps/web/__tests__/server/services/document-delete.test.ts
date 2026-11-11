/** @jest-environment node */

jest.mock("~/server/storage/deletion/plan", () => ({ planDocumentDeletion: jest.fn() }));
jest.mock("~/server/services/connectors/deleted-items", () => ({
    rememberDeletedSource: jest.fn(),
}));
jest.mock("~/server/db/schema", () => ({
    ChatHistory: {},
    documentReferenceResolution: {},
    documentViews: {},
    googleDrivePickedItem: { tableName: "googleDrivePickedItem" },
    predictiveDocumentAnalysisResults: {},
}));
import { deleteDocumentCore } from "~/server/services/document-delete";
import { planDocumentDeletion } from "~/server/storage/deletion/plan";
import { rememberDeletedSource } from "~/server/services/connectors/deleted-items";
import { googleDrivePickedItem } from "~/server/db/schema";

const context = { requestedBy: "user1", reason: "user_delete", traceId: "trace-delete" };
const mockDelete = jest.fn();
const mockSelectRows = jest.fn();
const mockDeleteTable = jest.fn();
const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: mockSelectRows }) }) }),
    delete: (table: unknown) => {
        mockDeleteTable(table);
        return { where: mockDelete };
    },
};
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(planDocumentDeletion).mockResolvedValue([1]);
    mockDelete.mockResolvedValue(undefined);
    mockSelectRows.mockResolvedValue([]);
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
it("keeps connector picks and tombstones untouched during archive expansion", async () => {
    mockSelectRows.mockResolvedValue([
        {
            title: "archive.zip",
            metadata: {
                connector: "google-drive",
                driveFileId: "archive",
                pickedRootId: "archive",
                connectionId: 1,
            },
        },
    ]);
    await deleteDocumentCore(tx as never, 7, {
        ...context,
        reason: "archive_expanded",
        rememberConnectorDeletion: false,
    });
    expect(planDocumentDeletion).toHaveBeenCalled();
    expect(rememberDeletedSource).not.toHaveBeenCalled();
    expect(mockDeleteTable).not.toHaveBeenCalledWith(googleDrivePickedItem);
});
it("can remove a failed attempt's rows without planning its caller-owned source bytes", async () => {
    await deleteDocumentCore(tx as never, 7, { ...context, planStorageDeletion: false });
    expect(planDocumentDeletion).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
});
