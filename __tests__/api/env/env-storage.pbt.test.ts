/**
 * Property-based tests for environment validation — storage provider configuration.
 * Feature: s3-or-database storage unification
 */

import * as fc from "fast-check";
import { z } from "zod";

// ─── Replicated schema helpers (mirrors src/env.ts) ──────────────────────────

const normalize = (value: unknown) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value;

const optionalString = () =>
    z.preprocess(normalize, z.string().min(1).optional());

/**
 * Isolated server schema covering only the storage-related fields.
 * Mirrors the relevant portion of serverSchema + serverSchemaRefined in src/env.ts.
 */
const storageServerSchema = z
    .object({
        NEXT_PUBLIC_STORAGE_PROVIDER: z.enum(["s3", "database"]).optional(),
        NEXT_PUBLIC_S3_ENDPOINT: optionalString(),
        S3_REGION: optionalString(),
        S3_ACCESS_KEY: optionalString(),
        S3_SECRET_KEY: optionalString(),
        S3_BUCKET_NAME: optionalString(),
    })
    .superRefine((data, ctx) => {
        if (data.NEXT_PUBLIC_STORAGE_PROVIDER === "s3") {
            const required = [
                "NEXT_PUBLIC_S3_ENDPOINT",
                "S3_REGION",
                "S3_ACCESS_KEY",
                "S3_SECRET_KEY",
                "S3_BUCKET_NAME",
            ] as const;
            for (const key of required) {
                if (!data[key]) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [key],
                        message: `${key} is required when NEXT_PUBLIC_STORAGE_PROVIDER is "s3"`,
                    });
                }
            }
        }
    });

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Any string that is not "s3" or "database" */
const invalidProviderArb = fc
    .string()
    .filter((s) => s !== "s3" && s !== "database");

/** Non-empty, non-whitespace string suitable as an S3 config value */
const s3ValueArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

/** Full set of S3 variables, all present */
const fullS3VarsArb = fc.record({
    NEXT_PUBLIC_S3_ENDPOINT: s3ValueArb,
    S3_REGION: s3ValueArb,
    S3_ACCESS_KEY: s3ValueArb,
    S3_SECRET_KEY: s3ValueArb,
    S3_BUCKET_NAME: s3ValueArb,
});

/** The names of the five required S3 variables */
const s3VarNames = [
    "NEXT_PUBLIC_S3_ENDPOINT",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET_NAME",
] as const;

type S3VarName = (typeof s3VarNames)[number];

// ─── Property 1: Storage provider enum validation ─────────────────────────────

describe(
    'Feature: storage unification, Property 1: Storage provider enum validation',
    () => {
        it('"database" is accepted by the schema', () => {
            const result = storageServerSchema.safeParse({
                NEXT_PUBLIC_STORAGE_PROVIDER: "database",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.NEXT_PUBLIC_STORAGE_PROVIDER).toBe("database");
            }
        });

        it('"s3" is accepted by the schema', () => {
            // Provide all required S3 vars so superRefine doesn't fail
            const result = storageServerSchema.safeParse({
                NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
                NEXT_PUBLIC_S3_ENDPOINT: "http://localhost:8333",
                S3_REGION: "us-east-1",
                S3_ACCESS_KEY: "key",
                S3_SECRET_KEY: "secret",
                S3_BUCKET_NAME: "bucket",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.NEXT_PUBLIC_STORAGE_PROVIDER).toBe("s3");
            }
        });

        it('NEXT_PUBLIC_STORAGE_PROVIDER is optional (undefined is accepted)', () => {
            const result = storageServerSchema.safeParse({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.NEXT_PUBLIC_STORAGE_PROVIDER).toBeUndefined();
            }
        });

        it('explicit undefined is accepted', () => {
            const result = storageServerSchema.safeParse({
                NEXT_PUBLIC_STORAGE_PROVIDER: undefined,
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.NEXT_PUBLIC_STORAGE_PROVIDER).toBeUndefined();
            }
        });

        it('any string other than "s3" or "database" is rejected', () => {
            fc.assert(
                fc.property(invalidProviderArb, (invalidValue) => {
                    const result = storageServerSchema.safeParse({
                        NEXT_PUBLIC_STORAGE_PROVIDER: invalidValue,
                    });
                    expect(result.success).toBe(false);
                }),
                { numRuns: 100 }
            );
        });
    }
);

// ─── Property 2: Conditional S3 variable requirement ─────────────────────────

describe(
    'Feature: storage unification, Property 2: Conditional S3 variable requirement',
    () => {
        it('when provider is "s3" and all S3 vars are present, validation succeeds', () => {
            fc.assert(
                fc.property(fullS3VarsArb, (s3Vars) => {
                    const result = storageServerSchema.safeParse({
                        NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
                        ...s3Vars,
                    });
                    expect(result.success).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('when provider is "s3" and any single S3 var is missing, validation fails', () => {
            fc.assert(
                fc.property(
                    fullS3VarsArb,
                    fc.constantFrom(...s3VarNames),
                    (s3Vars, missingKey: S3VarName) => {
                        const input: Record<string, string | undefined> = {
                            NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
                            ...s3Vars,
                        };
                        delete input[missingKey];

                        const result = storageServerSchema.safeParse(input);
                        expect(result.success).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('when provider is "s3" and any S3 var is an empty/whitespace string, validation fails', () => {
            fc.assert(
                fc.property(
                    fullS3VarsArb,
                    fc.constantFrom(...s3VarNames),
                    fc.array(fc.constantFrom(" ", "\t", "\n"), { minLength: 1, maxLength: 10 }).map(
                        (chars) => chars.join("")
                    ),
                    (s3Vars, targetKey: S3VarName, whitespaceValue) => {
                        const input = {
                            NEXT_PUBLIC_STORAGE_PROVIDER: "s3",
                            ...s3Vars,
                            [targetKey]: whitespaceValue,
                        };

                        const result = storageServerSchema.safeParse(input);
                        expect(result.success).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('when provider is "database", S3 vars are not required (validation succeeds without them)', () => {
            fc.assert(
                fc.property(
                    fc.subarray(s3VarNames as unknown as S3VarName[]),
                    s3ValueArb,
                    (presentKeys, value) => {
                        const input: Record<string, string> = {
                            NEXT_PUBLIC_STORAGE_PROVIDER: "database",
                        };
                        for (const key of presentKeys) {
                            input[key] = value;
                        }

                        const result = storageServerSchema.safeParse(input);
                        expect(result.success).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('when provider is absent, S3 vars are not required', () => {
            const result = storageServerSchema.safeParse({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.NEXT_PUBLIC_STORAGE_PROVIDER).toBeUndefined();
            }
        });
    }
);
