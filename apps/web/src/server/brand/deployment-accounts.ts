/**
 * Which workspace the deployment's own social accounts belong to.
 *
 * The operator's env keys (`TWITTER_BEARER_TOKEN`, `REDDIT_*`,
 * `LINKEDIN_ACCESS_TOKEN`, `BLUESKY_*`) name one account per network — one
 * company's account. On a single-workspace install that company is obvious.
 * On a shared server it is not, and offering those keys to every workspace
 * meant company B's post could go out as company A, with nothing failing:
 * the network accepted it. So the deployment accounts have exactly one
 * owner, and with no owner nobody posts through them:
 *
 * - `BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID` names the owner outright;
 * - otherwise the only workspace on the server owns them;
 * - otherwise (two or more workspaces, nothing named) no one does.
 *
 * Checked when channels are listed (so compose never offers them) and again
 * at publish time (so a post scheduled before this rule, or before a second
 * workspace joined, cannot slip through).
 */
import { company } from "@launchstack/store/schema";

import { env } from "~/env";
import { db } from "~/server/db";

export type DeploymentAccountsOwner =
    | { owner: bigint; reason: "configured" | "only-workspace" }
    | { owner: null; reason: "shared-server" | "configured-unknown" | "no-workspace" };

/**
 * The rule itself, free of I/O. `configured` is the raw env value;
 * `workspaceIds` needs at most two entries to decide.
 */
export function decideDeploymentAccountsOwner(
    configured: string | undefined,
    workspaceIds: readonly bigint[]
): DeploymentAccountsOwner {
    const named = configured?.trim();
    if (named) {
        // A typo must not fall through to "the only workspace": fail closed.
        return /^\d+$/.test(named)
            ? { owner: BigInt(named), reason: "configured" }
            : { owner: null, reason: "configured-unknown" };
    }
    if (workspaceIds.length === 0) return { owner: null, reason: "no-workspace" };
    if (workspaceIds.length === 1) return { owner: workspaceIds[0]!, reason: "only-workspace" };
    return { owner: null, reason: "shared-server" };
}

/** Reads the env and probes the company table (two rows at most). */
export async function deploymentAccountsOwner(): Promise<DeploymentAccountsOwner> {
    const rows = await db.select({ id: company.id }).from(company).limit(2);
    return decideDeploymentAccountsOwner(
        env.server.BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID,
        rows.map(r => BigInt(r.id))
    );
}

export async function mayUseDeploymentAccounts(companyId: bigint): Promise<boolean> {
    const { owner } = await deploymentAccountsOwner();
    return owner !== null && owner === companyId;
}

/** Why a workspace cannot post through the deployment's account, in the member's words. */
export function deploymentAccountRefusal(network: string): string {
    return `This server hosts more than one workspace, so its shared ${network} account is not this workspace's to post from. Connect this workspace's own ${network} account under Accounts, or ask the operator to assign the shared account to it.`;
}
