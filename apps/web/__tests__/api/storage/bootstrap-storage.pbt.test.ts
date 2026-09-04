/**
 * Property-based tests for bootstrap API storage provider reporting.
 * Feature: storage unification (s3 + database fallback)
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as WorkspaceContextHelper from "../../helpers/workspace-context";

import * as fc from "fast-check";

// ─── Mock dependencies ──────────────────────────────────────────────────────

// The route takes identity, tenant, and permissions from the workspace
// context. `settings.manage` is required, so the stub reports an owner.
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => ({
            success: true,
            data: jest
                .requireActual<typeof WorkspaceContextHelper>("../../helpers/workspace-context")
                .makeWorkspaceContext({
                    authUserId: "test-user-123",
                    userPk: BigInt(1),
                    companyId: BigInt(1),
                    role: "owner",
                }),
        }))
);

// The route reads validated env (~/env) for availableProviders.docling; the
// real module runs zod validation + import.meta at load time, so mock it.
jest.mock("~/env", () => ({
    env: {
        server: {
            DOCUMENT_CONVERTER_URL: process.env.DOCUMENT_CONVERTER_URL,
        },
    },
}));

jest.mock("drizzle-orm", () => ({
    and: jest.fn((...args: unknown[]) => args),
    eq: jest.fn((...args: unknown[]) => args),
    // Tagged-template helper used by the real ~/server/db/schema at load time.
    sql: jest.fn(() => "sql"),
}));

jest.mock("@launchstack/store/schema", () => ({
    category: { id: "id", name: "name", companyId: "companyId" },
    company: { id: "id", name: "name", useUploadThing: "useUploadThing" },
    users: { userId: "userId", role: "role", companyId: "companyId" },
}));

// The route imports `users` from the app-local schema barrel, whose real
// modules run drizzle table builders at load time — stub it out.
jest.mock("~/server/db/schema", () => ({
    users: { userId: "userId", role: "role", companyId: "companyId" },
    folderSettings: { categoryId: "folder_settings.category_id" },
}));

jest.mock("~/lib/storage", () => ({
    resolveStorageBackend: () => {
        const explicit = process.env.NEXT_PUBLIC_STORAGE_PROVIDER;
        if (explicit === "s3" || explicit === "database") return explicit;
        const hasS3 =
            Boolean(process.env.NEXT_PUBLIC_S3_ENDPOINT) &&
            Boolean(process.env.S3_REGION) &&
            Boolean(process.env.S3_ACCESS_KEY) &&
            Boolean(process.env.S3_SECRET_KEY) &&
            Boolean(process.env.S3_BUCKET_NAME);
        return hasS3 ? "s3" : "database";
    },
}));

const mockCategories = [{ id: 1, name: "General" }];
const mockCompany = [{ id: 1, name: "TestCo", useUploadThing: false }];

/**
 * Build a chainable mock that mirrors Drizzle's select().from().where().limit() pattern.
 * The bootstrap route uses Promise.all with two queries:
 *   1. categories: select().from(category).where(...)
 *   2. company:    select().from(company).where(...).limit(1)
 * The user lookup now lives inside requireWorkspaceContext, which is mocked
 * out entirely, so it never reaches this db stub.
 */
function mockCreateDb() {
    let callCount = 0;
    return {
        db: {
            select: jest.fn().mockImplementation(() => {
                callCount++;
                const currentCall = callCount;
                const terminal = currentCall === 1 ? mockCategories : mockCompany;

                // Object that is both a promise (thenable) and has .limit()
                const whereResult = {
                    limit: jest.fn().mockReturnValue(terminal),
                    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
                        Promise.resolve(terminal).then(resolve, reject),
                };

                return {
                    // The category query LEFT JOINs folder_settings to report
                    // `restricted`; the join returns the same builder.
                    from: jest.fn().mockImplementation(() => {
                        const builder: Record<string, unknown> = {
                            where: jest.fn().mockReturnValue(whereResult),
                        };
                        builder.leftJoin = jest.fn().mockReturnValue(builder);
                        return builder;
                    }),
                };
            }),
        },
    };
}

jest.mock("~/server/db", () => mockCreateDb());

// ─── Property 11: Bootstrap API storage provider reporting ──────────────────
// Validates: Requirements 9.1, 9.3

describe("Feature: local-s3-migration, Property 11: Bootstrap API storage provider reporting", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("response always includes storageProvider (resolved to 's3' or 'database') and isUploadThingConfigured", async () => {
        const providerArb = fc.constantFrom("s3", "database", undefined);
        const endpointArb = fc.option(
            fc
                .string({ minLength: 5, maxLength: 50, unit: "grapheme" })
                .map(s => `http://${s.replace(/[^a-z0-9]/gi, "x")}:8333`),
            { nil: undefined }
        );
        const uploadthingTokenArb = fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
            nil: undefined,
        });

        await fc.assert(
            fc.asyncProperty(
                providerArb,
                endpointArb,
                uploadthingTokenArb,
                async (provider, endpoint, uploadthingToken) => {
                    // Set env
                    if (provider !== undefined) {
                        process.env.NEXT_PUBLIC_STORAGE_PROVIDER = provider;
                    } else {
                        delete process.env.NEXT_PUBLIC_STORAGE_PROVIDER;
                    }
                    if (endpoint !== undefined) {
                        process.env.NEXT_PUBLIC_S3_ENDPOINT = endpoint;
                    } else {
                        delete process.env.NEXT_PUBLIC_S3_ENDPOINT;
                    }
                    if (uploadthingToken !== undefined) {
                        process.env.UPLOADTHING_TOKEN = uploadthingToken;
                    } else {
                        delete process.env.UPLOADTHING_TOKEN;
                    }

                    // Reset modules to pick up new env
                    jest.resetModules();
                    jest.doMock("~/server/auth", () => ({
                        getServerSession: jest
                            .fn()
                            .mockResolvedValue({ user: { id: "test-user-123" } }),
                    }));
                    jest.doMock("drizzle-orm", () => ({
                        and: jest.fn((...args: unknown[]) => args),
                        eq: jest.fn((...args: unknown[]) => args),
                    }));
                    jest.doMock("@launchstack/store/schema", () => ({
                        category: { id: "id", name: "name", companyId: "companyId" },
                        company: { id: "id", name: "name", useUploadThing: "useUploadThing" },
                        users: { userId: "userId", role: "role", companyId: "companyId" },
                    }));
                    jest.doMock("~/server/db", () => mockCreateDb());
                    jest.doMock("~/lib/storage", () => ({
                        resolveStorageBackend: () => {
                            const explicit = process.env.NEXT_PUBLIC_STORAGE_PROVIDER;
                            if (explicit === "s3" || explicit === "database") return explicit;
                            const hasS3 =
                                Boolean(process.env.NEXT_PUBLIC_S3_ENDPOINT) &&
                                Boolean(process.env.S3_REGION) &&
                                Boolean(process.env.S3_ACCESS_KEY) &&
                                Boolean(process.env.S3_SECRET_KEY) &&
                                Boolean(process.env.S3_BUCKET_NAME);
                            return hasS3 ? "s3" : "database";
                        },
                    }));

                    const { GET } = await import("~/app/api/employer/upload/bootstrap/route");
                    const response = await GET();
                    const body = await response.json();

                    // Must not be an error
                    expect(body.error).toBeUndefined();

                    // storageProvider must always be present
                    expect(body).toHaveProperty("storageProvider");
                    expect(["s3", "database"]).toContain(body.storageProvider);

                    // When explicitly set, matches; when absent, defaults to "database"
                    // (auto-fallback when S3 vars aren't fully configured in this test setup).
                    if (provider !== undefined) {
                        expect(body.storageProvider).toBe(provider);
                    }

                    // isUploadThingConfigured must always be present (backward compat)
                    expect(body).toHaveProperty("isUploadThingConfigured");
                    expect(typeof body.isUploadThingConfigured).toBe("boolean");

                    // s3Endpoint only present when resolved provider is "s3" and endpoint is set
                    if (body.storageProvider === "s3" && endpoint) {
                        expect(body.s3Endpoint).toBe(endpoint);
                    } else {
                        expect(body.s3Endpoint).toBeUndefined();
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
