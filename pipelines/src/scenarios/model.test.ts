import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
    BRIEF_SCHEMA,
    CAST_SCHEMA,
    DECISION_SCHEMA,
    REPORT_SCHEMA,
    type ModelRequest,
} from "@launchstack/simulation";

import { SCENARIO_SCHEMAS } from "./model";

/** Keys of the zod object at `path` (array items are stepped into). */
function zodKeys(schema: z.ZodTypeAny, path: string[] = []): string[] {
    let node = schema;
    for (const key of path) {
        node = (node as z.AnyZodObject).shape[key] as z.ZodTypeAny;
        if (node instanceof z.ZodArray) node = node.element as z.ZodTypeAny;
    }
    return Object.keys((node as z.AnyZodObject).shape).sort();
}

/** Required keys of the JSON schema at `path`. */
function jsonKeys(schema: Record<string, unknown>, path: string[] = []): string[] {
    let node = schema;
    for (const key of path) {
        node = (node.properties as Record<string, Record<string, unknown>>)[key]!;
        if (node.type === "array") node = node.items as Record<string, unknown>;
    }
    return [...(node.required as string[])].sort();
}

describe("the model's reply shapes", () => {
    // zod strips keys it doesn't know, so a field the engine asks for but the
    // mirror lacks never reaches the parser.
    it.each<[ModelRequest["purpose"], Record<string, unknown>, string[]]>([
        ["decide", DECISION_SCHEMA, []],
        ["decide", DECISION_SCHEMA, ["actions"]],
        ["cast", CAST_SCHEMA, ["personas"]],
        ["brief", BRIEF_SCHEMA, []],
        ["report", REPORT_SCHEMA, []],
    ])("mirror the engine's %s schema at %j", (purpose, engine, path) => {
        expect(zodKeys(SCENARIO_SCHEMAS[purpose] as z.ZodTypeAny, path)).toEqual(
            jsonKeys(engine, path)
        );
    });
});
