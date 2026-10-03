import { betterAuthSecretSchema } from "~/env";

/**
 * BETTER_AUTH_SECRET signs every session. A copied `.env.example` once booted
 * with the public placeholder; boot must refuse it, and anything too short.
 */
describe("BETTER_AUTH_SECRET validation", () => {
    const messageFor = (value: unknown) => {
        const result = betterAuthSecretSchema.safeParse(value);
        return result.success ? undefined : result.error.issues[0]?.message;
    };

    it.each([undefined, "", "   "])("refuses a missing secret (%p)", value => {
        expect(messageFor(value)).toMatch(/BETTER_AUTH_SECRET is required/);
    });

    it("refuses the .env.example placeholder", () => {
        expect(messageFor("BETTER_AUTH_SECRET")).toMatch(/placeholder/);
    });

    it("refuses a secret shorter than 32 characters", () => {
        expect(messageFor("x".repeat(31))).toMatch(/at least 32 characters/);
    });

    it("accepts a 32-character secret and a generated one", () => {
        expect(messageFor("x".repeat(32))).toBeUndefined();
        expect(messageFor("q7bH1nXk2v9yLmZ0pR4sT6uW8eA3cD5fG7hJ9kL1mN=")).toBeUndefined();
    });
});
