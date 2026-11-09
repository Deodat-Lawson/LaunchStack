jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/server/db", () => ({ db: { select: jest.fn() } }));
import { authorizeLegacyReviewRead } from "~/server/founder-weekly-review/read-authority";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import type { FounderWeeklyReviewRunRecord } from "@launchstack/pipelines/founder-weekly-review";
const auth = jest.mocked(requireWorkspaceContext);
const source = { sourceType: "workspace_document", metadata: { documentId: "12" } };
const run = () =>
    ({
        companyId: 1n,
        createdByActorId: "user:u",
        reviewPayload: {},
        evidenceSnapshot: { items: [source] },
    }) as unknown as FounderWeeklyReviewRunRecord;
const ctx = (companyId = 1n, allowed = true) => ({
    success: true,
    data: {
        companyId,
        authUserId: "u",
        can: () => true,
        documentScope: async () =>
            allowed
                ? { kind: "everything" }
                : {
                      kind: "only",
                      allowedCategories: [],
                      deniedDocumentIds: [],
                      allowedDocumentIds: [],
                  },
    },
});
describe("legacy derived report authority", () => {
    beforeEach(() => {
        auth.mockResolvedValue(ctx() as never);
        jest.mocked(db.select).mockReturnValue({
            from: () => ({ where: async () => [{ id: 12n, category: null }] }),
        } as never);
    });
    it("allows a historical report whose underlying document remains readable", async () => {
        await expect(authorizeLegacyReviewRead(run())).resolves.toBeUndefined();
    });
    it("denies source access after a revocation", async () => {
        auth.mockResolvedValue(ctx(1n, false) as never);
        await expect(authorizeLegacyReviewRead(run())).rejects.toMatchObject({ status: 403 });
    });
    it("denies another company before source reads", async () => {
        auth.mockResolvedValue(ctx(2n) as never);
        await expect(authorizeLegacyReviewRead(run())).rejects.toMatchObject({ status: 403 });
    });
    it("fails closed for a missing snapshot", async () => {
        await expect(
            authorizeLegacyReviewRead({ ...run(), evidenceSnapshot: null })
        ).rejects.toMatchObject({ status: 403 });
    });
    it("fails closed for a missing document dependency", async () => {
        jest.mocked(db.select).mockReturnValue({
            from: () => ({ where: async () => [] }),
        } as never);
        await expect(authorizeLegacyReviewRead(run())).rejects.toMatchObject({ status: 403 });
    });
    it("denies another reader of legacy private founder context", async () => {
        const value = run();
        value.createdByActorId = "user:other";
        value.evidenceSnapshot!.items = [{ sourceType: "founder_context", metadata: {} } as never];
        await expect(authorizeLegacyReviewRead(value)).rejects.toMatchObject({ status: 403 });
    });
});
