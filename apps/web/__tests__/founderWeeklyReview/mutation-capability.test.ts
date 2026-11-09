import { FounderWeeklyReviewUserService } from "@launchstack/pipelines/founder-weekly-review";
import type { FounderWeeklyReviewRepository } from "@launchstack/pipelines/founder-weekly-review";
describe("FWR mutation capability", () => {
    const request = {
        requestKey: "key",
        reportingPeriod: { start: "2026-11-02", end: "2026-11-08" },
    };
    const actor = { externalUserId: "u", companyId: 1n, role: "member" };
    it("accepts normalized member with explicit server capability", async () => {
        const create = jest.fn(async () => ({ run: { id: "accepted" } }));
        const service = new FounderWeeklyReviewUserService({
            createOrGetByRequestKeyWithResult: create,
        } as unknown as FounderWeeklyReviewRepository);
        await expect(
            service.createOrGetRun({ ...actor, canMutate: true }, request)
        ).resolves.toMatchObject({ id: "accepted" });
        expect(create).toHaveBeenCalledTimes(1);
    });
    it.each([undefined, false])(
        "does not trust a privileged role alias without capability",
        async canMutate => {
            const create = jest.fn();
            const service = new FounderWeeklyReviewUserService({
                createOrGetByRequestKeyWithResult: create,
            } as unknown as FounderWeeklyReviewRepository);
            await expect(
                service.createOrGetRun({ ...actor, role: "owner", canMutate }, request)
            ).rejects.toMatchObject({ status: 403 });
            expect(create).not.toHaveBeenCalled();
        }
    );
});
