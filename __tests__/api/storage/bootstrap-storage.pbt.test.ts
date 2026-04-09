/**
 * Property-based tests for bootstrap API storage provider reporting.
 * Feature: local-s3-migration
 */

import * as fc from "fast-check";

// ─── Mock dependencies ──────────────────────────────────────────────────────

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "test-user-123" }),
}));

jest.mock("drizzle-orm", () => ({
  and: jest.fn((...args: unknown[]) => args),
  eq: jest.fn((...args: unknown[]) => args),
}));

jest.mock("~/server/db/schema", () => ({
  category: { id: "id", name: "name", companyId: "companyId" },
  company: { id: "id", name: "name", useUploadThing: "useUploadThing" },
  users: { userId: "userId", role: "role", companyId: "companyId" },
}));

const mockUser = [{ role: "employer", companyId: 1 }];
const mockCategories = [{ id: 1, name: "General" }];
const mockCompany = [{ id: 1, name: "TestCo", useUploadThing: false }];

/**
 * Build a chainable mock that mirrors Drizzle's select().from().where().limit() pattern.
 * The bootstrap route uses Promise.all with two queries:
 *   1. categories: select().from(category).where(...)
 *   2. company:    select().from(company).where(...).limit(1)
 * Plus the initial user query: select().from(users).where(...)
 */
function mockCreateDb() {
  let callCount = 0;
  return {
    db: {
      select: jest.fn().mockImplementation(() => {
        callCount++;
        const currentCall = callCount;
        const terminal = (() => {
          if (currentCall === 1) return mockUser;
          if (currentCall === 2) return mockCategories;
          return mockCompany;
        })();

        // Object that is both a promise (thenable) and has .limit()
        const whereResult = {
          limit: jest.fn().mockReturnValue(terminal),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(terminal).then(resolve, reject),
        };

        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(whereResult),
          }),
        };
      }),
    },
  };
}

jest.mock("~/server/db", () => mockCreateDb());

// ─── Property 11: Bootstrap API storage provider reporting ──────────────────
// Validates: Requirements 9.1, 9.3

describe(
  "Feature: local-s3-migration, Property 11: Bootstrap API storage provider reporting",
  () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("response always includes storageProvider (defaulting to 'cloud') and isUploadThingConfigured", async () => {
      const providerArb = fc.constantFrom("cloud", "local", undefined);
      const endpointArb = fc.option(
        fc.string({ minLength: 5, maxLength: 50, unit: "grapheme" }).map(
          (s) => `http://${s.replace(/[^a-z0-9]/gi, "x")}:8333`,
        ),
        { nil: undefined },
      );
      const uploadthingTokenArb = fc.option(
        fc.string({ minLength: 1, maxLength: 30 }),
        { nil: undefined },
      );

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
            jest.doMock("@clerk/nextjs/server", () => ({
              auth: jest.fn().mockResolvedValue({ userId: "test-user-123" }),
            }));
            jest.doMock("drizzle-orm", () => ({
              and: jest.fn((...args: unknown[]) => args),
              eq: jest.fn((...args: unknown[]) => args),
            }));
            jest.doMock("~/server/db/schema", () => ({
              category: { id: "id", name: "name", companyId: "companyId" },
              company: { id: "id", name: "name", useUploadThing: "useUploadThing" },
              users: { userId: "userId", role: "role", companyId: "companyId" },
            }));
            jest.doMock("~/server/db", () => mockCreateDb());

            const { GET } = await import(
              "~/app/api/employer/upload/bootstrap/route"
            );
            const response = await GET();
            const body = await response.json();

            // Must not be an error
            expect(body.error).toBeUndefined();

            // storageProvider must always be present
            expect(body).toHaveProperty("storageProvider");
            expect(["cloud", "local"]).toContain(body.storageProvider);

            // Defaults to "cloud" when env is not set
            if (provider === undefined) {
              expect(body.storageProvider).toBe("cloud");
            } else {
              expect(body.storageProvider).toBe(provider);
            }

            // isUploadThingConfigured must always be present (backward compat)
            expect(body).toHaveProperty("isUploadThingConfigured");
            expect(typeof body.isUploadThingConfigured).toBe("boolean");

            // s3Endpoint only present when provider is "local" and endpoint is set
            if (provider === "local" && endpoint) {
              expect(body.s3Endpoint).toBe(endpoint);
            } else {
              expect(body.s3Endpoint).toBeUndefined();
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
