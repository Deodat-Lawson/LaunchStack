import {
    authErrorDiagnostic,
    logAuthDiagnostic,
    sessionLookupError,
} from "~/server/auth/error-diagnostics";

describe("safe authentication diagnostics", () => {
    it("extracts only a PG code through a bounded cause chain", () => {
        const error = new Error("SQL token=private-session", {
            cause: { code: "53300", params: ["private-session"] },
        });
        expect(authErrorDiagnostic(error)).toEqual({ code: "53300" });
        const sanitized = sessionLookupError(error);
        expect(sanitized).toMatchObject({
            message: "Authentication session lookup failed",
            code: "53300",
        });
        expect(sanitized).not.toHaveProperty("cause");
        const spy = jest.spyOn(console, "error").mockImplementation();
        logAuthDiagnostic("error", error.message, error);
        expect(spy).toHaveBeenCalledWith("[auth] runtime diagnostic", { code: "53300" });
        expect(JSON.stringify(spy.mock.calls)).not.toContain("private-session");
        spy.mockRestore();
    });
    it("bounds cyclic/deep errors and rejects free-form diagnostic codes", () => {
        const cycle: { cause?: unknown } = {};
        cycle.cause = cycle;
        expect(authErrorDiagnostic(cycle)).toEqual({ code: "UNKNOWN" });
        let deep: unknown = { code: "53300" };
        for (let index = 0; index < 9; index++) deep = { cause: deep };
        expect(authErrorDiagnostic(deep)).toEqual({ code: "UNKNOWN" });
        expect(authErrorDiagnostic({ code: "session-token-secret" })).toEqual({ code: "UNKNOWN" });
    });
});
