import { canUseVantage } from "~/server/vantage/access";
import type { Permission } from "~/lib/authz/permissions";

const saved = { ...process.env };
beforeEach(() => {
    process.env.VANTAGE_TEST_MODE = "true";
    process.env.VANTAGE_TEST_COMPANY_ID = "42";
    process.env.VANTAGE_TEST_USER_IDS = "test-founder";
    process.env.DATABASE_URL = "postgres://test:test@localhost:55434/vantage_test";
    process.env.VANTAGE_TEST_DATABASE_URL = process.env.DATABASE_URL;
});
afterEach(() => {
    process.env = { ...saved };
});
const ctx = () => ({
    companyId: 42n,
    authUserId: "test-founder",
    can: (p: Permission) => p === "documents.read" || p === "documents.edit",
});
it("admits an explicitly configured operator without owner-role coupling", () => {
    expect(canUseVantage(ctx())).toBe(true);
});
it("denies a different company and actor", () => {
    expect(canUseVantage({ ...ctx(), companyId: 43n })).toBe(false);
    expect(canUseVantage({ ...ctx(), authUserId: "other" })).toBe(false);
});
it("requires both source permissions", () => {
    expect(canUseVantage({ ...ctx(), can: () => false })).toBe(false);
});
it("fails closed without test mode or matching database target", () => {
    process.env.VANTAGE_TEST_MODE = "false";
    expect(canUseVantage(ctx())).toBe(false);
    process.env.VANTAGE_TEST_MODE = "true";
    process.env.VANTAGE_TEST_DATABASE_URL = "postgres://other";
    expect(canUseVantage(ctx())).toBe(false);
});
