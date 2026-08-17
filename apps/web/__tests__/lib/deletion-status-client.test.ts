import { pollDocumentDeletion } from "~/lib/deletion-status-client";

describe("pollDocumentDeletion", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("does not treat manual review as a successful delete", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    status: "manual_review",
                    itemCount: 1,
                }),
                { status: 200 }
            )
        );

        await expect(pollDocumentDeletion(42)).resolves.toMatchObject({
            kind: "terminal_failure",
            status: "manual_review",
        });
    });

    it("returns completed only for the completed status", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ success: true, status: "completed" }), {
                status: 200,
            })
        );

        await expect(pollDocumentDeletion(42)).resolves.toMatchObject({
            kind: "completed",
            status: "completed",
        });
    });
});
