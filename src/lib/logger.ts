/**
 * Structured logging utility using pino.
 *
 * Usage:
 *   import { logger } from "~/lib/logger";
 *   logger.info({ documentId: 42 }, "Document processed");
 *   logger.error({ err: error }, "Failed to process request");
 */

import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  // Use pino-pretty for local dev readability; raw JSON in production
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: "launchstack",
  },
});

/** Create a child logger scoped to a module/feature */
export function createLogger(module: string) {
  return logger.child({ module });
}
