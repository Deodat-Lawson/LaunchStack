import { TopicPatchSchema } from "../_schemas";

describe("Vantage topic PATCH contract", () => {
    it("requires a positive integer content version", () => {
        expect(TopicPatchSchema.safeParse({ title: "Edited" }).success).toBe(false);
        expect(
            TopicPatchSchema.safeParse({ title: "Edited", expectedContentVersion: 0 }).success
        ).toBe(false);
        expect(
            TopicPatchSchema.safeParse({ title: "Edited", expectedContentVersion: 1.5 }).success
        ).toBe(false);
        expect(
            TopicPatchSchema.safeParse({ title: "Edited", expectedContentVersion: 1 }).success
        ).toBe(true);
    });
});
