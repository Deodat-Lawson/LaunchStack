/** Never forward database messages, SQL parameters, request data or raw causes to logs. */
export function authErrorDiagnostic(error: unknown): { code: string } {
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
        if (seen.has(current)) break;
        seen.add(current);
        const candidate = current as { code?: unknown; cause?: unknown };
        if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code))
            return { code: candidate.code };
        current = candidate.cause;
    }
    return { code: "UNKNOWN" };
}

/** Better Auth can log a Drizzle error before the application catches it. */
export function logAuthDiagnostic(
    level: "debug" | "info" | "warn" | "error",
    _message: string,
    ...args: unknown[]
): void {
    const diagnostic = args.map(authErrorDiagnostic).find(item => item.code !== "UNKNOWN") ?? {
        code: "UNKNOWN",
    };
    // Keep severity and a bounded diagnostic, including for failures with no PG code.
    console[level]("[auth] runtime diagnostic", diagnostic);
}

/** Session APIs still reject; the propagated error is safe for Next's dev overlay. */
export function sessionLookupError(error: unknown): Error {
    return Object.assign(
        new Error("Authentication session lookup failed"),
        authErrorDiagnostic(error)
    );
}
