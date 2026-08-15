/**
 * Tiny structured JSON logger — one line per event, no external framework.
 *
 * Every line is `{"ts", "level", "msg", ...fields}`. Handlers thread the
 * request's `traceId` through `fields` so one user command can be correlated
 * across web, worker and compute services (ADR-004 §6).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...fields,
    });
    if (level === "error" || level === "warn") {
        process.stderr.write(line + "\n");
    } else {
        process.stdout.write(line + "\n");
    }
}
