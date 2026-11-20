import { discardUnrecordedObject } from "~/server/storage/compensate";
import { deleteStoredObjects } from "~/server/storage/delete-objects";
import type { ObjectRef } from "~/server/storage/object-ref";

jest.mock("~/server/storage/delete-objects", () => ({ deleteStoredObjects: jest.fn() }));
const ref: ObjectRef = {
    adapter: "s3",
    storageLocationId: "s3:https://objects.example@files",
    key: "documents/a.pdf",
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it.each(["deleted", "not_found"])("acknowledges %s compensation", async outcome => {
    (deleteStoredObjects as jest.Mock).mockResolvedValue([{ ref, outcome }]);
    await expect(discardUnrecordedObject(ref, "test write")).resolves.toBe(true);
    expect(deleteStoredObjects).toHaveBeenCalledWith([ref]);
    expect(console.warn).not.toHaveBeenCalled();
});

it.each(["blocked", "retryable", "unexpected", "missing"])(
    "logs %s compensation and retains inventory",
    async outcome => {
        const results = outcome === "missing" ? [] : [{ ref, outcome }];
        (deleteStoredObjects as jest.Mock).mockResolvedValue(results);
        await expect(discardUnrecordedObject(ref, "test write")).resolves.toBe(false);
        expect(console.warn).toHaveBeenCalledWith("Failed to compensate storage write", {
            context: "test write",
            ref,
            results,
        });
    }
);

it("logs a thrown cleanup error without masking the original write failure", async () => {
    const error = new Error("provider unavailable");
    (deleteStoredObjects as jest.Mock).mockRejectedValue(error);
    await expect(discardUnrecordedObject(ref, "test write")).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledWith("Failed to compensate storage write", {
        context: "test write",
        ref,
        error,
    });
});
