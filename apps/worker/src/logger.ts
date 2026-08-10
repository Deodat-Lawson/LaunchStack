/**
 * Structured JSON logger for the worker. One line per record:
 * {"level","time","msg",...fields}. Matches the LoggerPort shape the
 * application layer expects, so the same instance threads everywhere.
 */
import type { LoggerPort } from "@launchstack/application";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function write(
  minLevel: Level,
  level: Level,
  obj: Record<string, unknown> | string,
  msg?: string,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const fields = typeof obj === "string" ? {} : obj;
  const message = typeof obj === "string" ? obj : (msg ?? "");
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields,
  });
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function createLogger(minLevel: Level = "info"): LoggerPort {
  return {
    debug: (obj, msg) => write(minLevel, "debug", obj, msg),
    info: (obj, msg) => write(minLevel, "info", obj, msg),
    warn: (obj, msg) => write(minLevel, "warn", obj, msg),
    error: (obj, msg) => write(minLevel, "error", obj, msg),
  };
}
