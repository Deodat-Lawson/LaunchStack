import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ResolvedChatModel } from "./chat-model-factory";
import { getChatModelPreset } from "./presets";
import { invokeStructuredWithUsage } from "./structured-output";

/** A chat model that records what withStructuredOutput received. */
function fakeResolved(
    parsed: unknown,
    options: { nativeError?: Error; nativeErrors?: Error[]; text?: string } = {}
) {
    const seen: { schema?: unknown; schemas: unknown[]; method?: string; plainCalls: number } = {
        schemas: [],
        plainCalls: 0,
    };
    const queued = [...(options.nativeErrors ?? [])];
    const chat = {
        withStructuredOutput(schema: unknown, config: { method?: string }) {
            seen.schema = schema;
            seen.schemas.push(schema);
            seen.method = config.method;
            return {
                invoke: async () => {
                    const next = queued.shift();
                    if (next) throw next;
                    if (options.nativeError) throw options.nativeError;
                    return { parsed, raw: { content: "" } };
                },
            };
        },
        invoke: async () => {
            seen.plainCalls += 1;
            return { content: options.text ?? "" };
        },
    };
    const resolved = {
        route: "default",
        name: "primary",
        modelId: "gemini-3.8-flash",
        behavior: getChatModelPreset("google/gemini-3.8-flash")!.behavior,
        inheritsDefault: false,
        chat,
        prepareMessages: (messages: unknown[]) => messages,
    } as unknown as ResolvedChatModel;
    return { resolved, seen };
}

const schema = z.object({
    title: z.string(),
    priorities: z.array(z.object({ item: z.string(), rationale: z.string().optional() })),
});

describe("invokeStructuredWithUsage in json-schema mode", () => {
    it("sends a plain JSON Schema, so optional fields are not refused before the request", async () => {
        // OpenAI's strict Zod helper threw "uses .optional() without .nullable()"
        // for this schema, failing Vantage's weekly review and the prospector.
        const { resolved, seen } = fakeResolved({ title: "t", priorities: [{ item: "a" }] });

        const { result } = await invokeStructuredWithUsage(resolved, schema, [], { name: "plan" });

        expect(seen.method).toBe("jsonSchema");
        expect(seen.schema).toMatchObject({ type: "object", required: ["title", "priorities"] });
        expect(JSON.stringify(seen.schema)).not.toContain("$ref");
        expect(result).toEqual({ title: "t", priorities: [{ item: "a" }] });
    });

    it("sends literals as single-value enums, which Gemini enforces and `const` it does not", async () => {
        const versioned = z.object({ schemaVersion: z.literal("v2"), title: z.string() });
        const { resolved, seen } = fakeResolved({ schemaVersion: "v2", title: "t" });

        await invokeStructuredWithUsage(resolved, versioned, [], { name: "versioned" });

        expect(JSON.stringify(seen.schema)).not.toContain('"const"');
        expect(seen.schema).toMatchObject({
            properties: { schemaVersion: { enum: ["v2"] } },
        });
    });

    it("still enforces the schema on what comes back", async () => {
        const { resolved } = fakeResolved({ title: 1, priorities: [] });

        await expect(
            invokeStructuredWithUsage(resolved, schema, [], { name: "plan" })
        ).rejects.toThrow();
    });

    it("falls back to the prompt path when the endpoint refuses the schema with a 400", async () => {
        // Gemini answers a schema it finds too complex with a bare 400.
        const refused = Object.assign(new Error("400 status code (no body)"), { status: 400 });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { resolved, seen } = fakeResolved(undefined, {
            nativeError: refused,
            text: '{"title":"t","priorities":[]}',
        });

        const { result } = await invokeStructuredWithUsage(resolved, schema, [], { name: "plan" });

        expect(result).toEqual({ title: "t", priorities: [] });
        expect(seen.plainCalls).toBe(1);
        warn.mockRestore();
    });

    it("retries without size bounds when the endpoint refuses the schema", async () => {
        // Gemini accepts the founder weekly review's schema once maxItems is gone.
        const refused = Object.assign(new Error("400 status code (no body)"), { status: 400 });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const bounded = z.object({ items: z.array(z.string().max(80)).max(5) });
        const { resolved, seen } = fakeResolved({ items: ["a"] }, { nativeErrors: [refused] });

        const { result } = await invokeStructuredWithUsage(resolved, bounded, [], {
            name: "bounded",
        });

        expect(result).toEqual({ items: ["a"] });
        expect(seen.plainCalls).toBe(0);
        expect(JSON.stringify(seen.schemas[0])).toContain("maxItems");
        expect(JSON.stringify(seen.schemas[1])).not.toMatch(/maxItems|maxLength/);
        warn.mockRestore();
    });

    it("still applies the bounds to a result from the relaxed schema", async () => {
        const refused = Object.assign(new Error("400 status code (no body)"), { status: 400 });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const bounded = z.object({ items: z.array(z.string()).max(1) });
        const { resolved } = fakeResolved({ items: ["a", "b"] }, { nativeErrors: [refused] });

        await expect(
            invokeStructuredWithUsage(resolved, bounded, [], { name: "bounded-strict" })
        ).rejects.toThrow();
        warn.mockRestore();
    });

    it("does not swallow errors other than a 400", async () => {
        const outage = Object.assign(new Error("503"), { status: 503 });
        const { resolved, seen } = fakeResolved(undefined, { nativeError: outage });

        await expect(
            invokeStructuredWithUsage(resolved, schema, [], { name: "plan" })
        ).rejects.toThrow("503");
        expect(seen.plainCalls).toBe(0);
    });
});
