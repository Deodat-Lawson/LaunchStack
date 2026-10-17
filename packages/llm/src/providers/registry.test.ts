import { describe, expect, it } from "vitest";

import { resolveModel } from "./registry";

describe("resolveModel", () => {
    it("uses the capability's model when one is named", () => {
        expect(resolveModel("gemini-3.6-flash", "gemini-3.8-flash")).toBe("gemini-3.6-flash");
    });

    it("falls back when the variable is unset", () => {
        expect(resolveModel(undefined, "gemini-3.8-flash")).toBe("gemini-3.8-flash");
    });

    // Compose passes allowlisted variables as `${VAR:-}`: unset arrives as "".
    it.each(["", "   "])("treats a blank value (%j) as unset", blank => {
        expect(resolveModel(blank, "gemini-3.8-flash")).toBe("gemini-3.8-flash");
    });
});
