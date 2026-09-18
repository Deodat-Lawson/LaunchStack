import { describeRunMode, pickRunMode, readRunEnvironment } from "~/server/prospects/run-mode";

describe("run mode", () => {
    it("reads model and search availability from the environment", () => {
        expect(readRunEnvironment({})).toEqual({ hasModel: false, hasSearch: false });
        expect(readRunEnvironment({ AI_API_KEY: "x" }).hasModel).toBe(true);
        expect(readRunEnvironment({ OPENAI_API_KEY: "x", EXA_API_KEY: "y" })).toEqual({
            hasModel: true,
            hasSearch: true,
        });
        expect(readRunEnvironment({ FOURSQUARE_SERVICE_KEY: "z" }).hasSearch).toBe(true);
    });

    it("falls back to keyless whenever a fresh dev environment lacks keys", () => {
        expect(pickRunMode("auto", { hasModel: false, hasSearch: false })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: true, hasSearch: false })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: false, hasSearch: true })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: true, hasSearch: true })).toBe("live");
        expect(pickRunMode("sample", { hasModel: true, hasSearch: true })).toBe("fixture");
        expect(pickRunMode("keyless", { hasModel: true, hasSearch: true })).toBe("keyless");
        expect(describeRunMode("keyless")).toBe("public sources, no keys");
    });
});
