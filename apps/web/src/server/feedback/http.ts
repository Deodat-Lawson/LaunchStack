import "server-only";

/**
 * `parseValue` (~/server/workspace/http) for the contract's schemas, whose
 * parsed type differs from what they accept — defaults (`sort`, `limit`,
 * `body`, `context`) and coercion (`limit` from the query string). The
 * answer to a bad value is the same `{ error }` 400.
 */

import type { z } from "zod";

import { parseValue } from "~/server/workspace/http";

export function parseContract<S extends z.ZodTypeAny>(value: unknown, schema: S, request: Request) {
    return parseValue<z.output<S>>(value, schema as unknown as z.ZodSchema<z.output<S>>, request);
}
