import type { WorkspaceContext } from "~/lib/require-workspace-context";

/** Fail closed until an explicit isolated test workspace/operator set is configured. */
export function canUseVantage(
    ctx: Pick<WorkspaceContext, "companyId" | "authUserId" | "can">
): boolean {
    const users = (process.env.VANTAGE_TEST_USER_IDS ?? "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    return (
        process.env.VANTAGE_TEST_MODE === "true" &&
        !!process.env.VANTAGE_TEST_DATABASE_URL &&
        process.env.VANTAGE_TEST_DATABASE_URL === process.env.DATABASE_URL &&
        !!process.env.VANTAGE_TEST_COMPANY_ID &&
        ctx.companyId.toString() === process.env.VANTAGE_TEST_COMPANY_ID &&
        users.includes(ctx.authUserId) &&
        ctx.can("documents.read") &&
        ctx.can("documents.edit")
    );
}

export const VANTAGE_FOUNDER_ONLY =
    "Weekly Decision Agenda is limited to the configured isolated test workspace and operators.";

export const VANTAGE_SHARING_DISABLED =
    "Program sharing and external delivery are disabled until the access and approval policy is implemented.";
