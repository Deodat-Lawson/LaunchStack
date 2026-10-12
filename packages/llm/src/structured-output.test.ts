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
    const seen: {
        schema?: unknown;
        schemas: unknown[];
        method?: string;
        strict?: boolean;
        plainCalls: number;
    } = {
        schemas: [],
        plainCalls: 0,
    };
    const queued = [...(options.nativeErrors ?? [])];
    const chat = {
        withStructuredOutput(schema: unknown, config: { method?: string; strict?: boolean }) {
            seen.schema = schema;
            seen.schemas.push(schema);
            seen.method = config.method;
            seen.strict = config.strict;
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
    it("requests strict JSON Schema and decodes optional nulls before Zod validation", async () => {
        // A plain schema bypasses OpenAI's strict Zod helper; the endpoint still
        // requires optional properties, using null to represent a missing value.
        const { resolved, seen } = fakeResolved({
            title: "t",
            priorities: [{ item: "a", rationale: null }],
        });

        const { result } = await invokeStructuredWithUsage(resolved, schema, [], { name: "plan" });

        expect(seen.method).toBe("jsonSchema");
        expect(seen.strict).toBe(true);
        expect(seen.schema).toMatchObject({
            type: "object",
            required: ["title", "priorities"],
            additionalProperties: false,
            properties: {
                priorities: {
                    items: {
                        required: ["item", "rationale"],
                        additionalProperties: false,
                        properties: {
                            rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
                        },
                    },
                },
            },
        });
        expect(JSON.stringify(seen.schema)).not.toContain("$ref");
        expect(result).toEqual({ title: "t", priorities: [{ item: "a", rationale: undefined }] });
    });

    it.each(["a", "b"] as const)(
        "decodes an optional null in discriminated-union branch %s",
        async kind => {
            const discriminated = z.discriminatedUnion("kind", [
                z.object({ kind: z.literal("a"), value: z.string().optional() }),
                z.object({ kind: z.literal("b"), value: z.number().optional() }),
            ]);
            const { resolved } = fakeResolved({ kind, value: null });

            const { result } = await invokeStructuredWithUsage(resolved, discriminated, [], {
                name: "discriminated",
            });

            expect(result).toEqual({ kind, value: undefined });
        }
    );

    it("preserves nullable fields and applies defaults in a discriminated-union branch", async () => {
        const discriminated = z.discriminatedUnion("kind", [
            z.object({
                kind: z.literal("a"),
                value: z.string().optional(),
                nullable: z.string().nullable(),
                optionalNullable: z.string().nullable().optional(),
                defaulted: z.string().default("default"),
            }),
            z.object({ kind: z.literal("b") }),
        ]);
        const { resolved } = fakeResolved({
            kind: "a",
            value: null,
            nullable: null,
            optionalNullable: null,
            defaulted: null,
        });

        const { result } = await invokeStructuredWithUsage(resolved, discriminated, [], {
            name: "discriminated-nullable",
        });

        expect(result).toEqual({
            kind: "a",
            value: undefined,
            nullable: null,
            optionalNullable: null,
            defaulted: "default",
        });
    });

    it("preserves a discriminated union's custom validation error", async () => {
        const discriminated = z.discriminatedUnion(
            "kind",
            [
                z.object({ kind: z.literal("a"), value: z.string().optional() }),
                z.object({ kind: z.literal("b") }),
            ],
            { errorMap: () => ({ message: "Unknown result kind" }) }
        );
        const { resolved } = fakeResolved({ kind: "unknown", value: null });

        await expect(
            invokeStructuredWithUsage(resolved, discriminated, [], {
                name: "discriminated-invalid",
            })
        ).rejects.toThrow("Unknown result kind");
    });

    it("decodes optional nulls on both sides of an intersection", async () => {
        const intersected = z.intersection(
            z.object({ title: z.string(), value: z.string().optional() }),
            z.object({ count: z.number(), rationale: z.string().optional() })
        );
        const { resolved } = fakeResolved({
            title: "t",
            value: null,
            count: 1,
            rationale: null,
        });

        const { result } = await invokeStructuredWithUsage(resolved, intersected, [], {
            name: "intersection",
        });

        expect(result).toEqual({
            title: "t",
            value: undefined,
            count: 1,
            rationale: undefined,
        });
    });

    it("decodes optional nulls in both fixed and rest tuple items", async () => {
        const tuple = z.object({
            values: z
                .tuple([z.object({ value: z.string().optional() })])
                .rest(z.object({ value: z.number().optional() })),
        });
        const { resolved } = fakeResolved({ values: [{ value: null }, { value: null }] });

        const { result } = await invokeStructuredWithUsage(resolved, tuple, [], {
            name: "tuple",
        });

        expect(result).toEqual({ values: [{ value: undefined }, { value: undefined }] });
    });

    const optionalObject = z.object({ value: z.string().optional() });
    const wrappedObjects: Array<{ name: string; schema: z.ZodTypeAny }> = [
        { name: "pipeline input", schema: optionalObject.pipe(z.unknown()) },
        {
            name: "pipeline output",
            schema: z.object({ value: z.string().nullable() }).pipe(optionalObject),
        },
        { name: "catch", schema: optionalObject.catch({ value: "fallback" }) },
        { name: "brand", schema: optionalObject.brand<"StructuredObject">() },
        { name: "readonly", schema: optionalObject.readonly() },
    ];

    it.each(wrappedObjects)("decodes optional nulls inside $name", async ({ name, schema }) => {
        const { resolved } = fakeResolved({ value: null });

        const { result } = await invokeStructuredWithUsage(resolved, schema, [], {
            name,
        });

        expect(result).toEqual({ value: undefined });
        if (name === "readonly") expect(Object.isFrozen(result)).toBe(true);
    });

    it("still applies a catch fallback when the inner value is invalid", async () => {
        const caught = optionalObject.catch({ value: "fallback" });
        const { resolved } = fakeResolved({ value: 1 });

        const { result } = await invokeStructuredWithUsage(resolved, caught, [], {
            name: "catch-invalid",
        });

        expect(result).toEqual({ value: "fallback" });
    });

    it("decodes optional nulls inside catchall values without losing their keys", async () => {
        const catchall = z.object({}).catchall(optionalObject);
        const { resolved } = fakeResolved({
            first: { value: null },
            second: { value: "present" },
        });

        const { result } = await invokeStructuredWithUsage(resolved, catchall, [], {
            name: "catchall",
        });

        expect(result).toEqual({
            first: { value: undefined },
            second: { value: "present" },
        });
    });

    const nonJsonContainers: Array<{
        name: string;
        schema: z.ZodTypeAny;
        parsed: unknown;
    }> = [
        { name: "promise", schema: z.promise(optionalObject), parsed: { value: null } },
        {
            name: "map",
            schema: z.map(z.string(), optionalObject),
            parsed: [["key", { value: null }]],
        },
        { name: "set", schema: z.set(optionalObject), parsed: [{ value: null }] },
    ];

    it.each(nonJsonContainers)(
        "does not coerce JSON into a $name",
        async ({ name, schema, parsed }) => {
            const { resolved } = fakeResolved(parsed);

            await expect(
                invokeStructuredWithUsage(resolved, schema, [], { name })
            ).rejects.toThrow();
        }
    );

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
