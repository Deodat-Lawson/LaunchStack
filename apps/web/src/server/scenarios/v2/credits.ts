/**
 * The workspace ledger behind v2 scenario credit holds.
 *
 * Holds themselves live in `scenario_credit_reservations` (see
 * pipelines/src/scenarios/v2/credits.ts): they are counted against the
 * balance at admission but never written to `token_transactions` or
 * `token_usage_daily`, so the Usage tab's spending, by-service and by-route
 * figures only ever see what committed units actually used. Each settled unit
 * is one ordinary `debit` row (`scenario_simulation`, referenceId
 * `scenario:<runId>`), with the settlement key and the credits it had held in
 * its metadata — which is how a balance change is traced back to its hold.
 */
import { eq } from "drizzle-orm";

import {
    createScenarioCredits,
    type ScenarioCreditsPort,
    type ScenarioLedger,
} from "@launchstack/pipelines/scenarios/v2/db";

import { debitTokens, ensureTokenAccount } from "~/lib/credits";
import { tokenAccounts } from "~/server/db/schema";
import { isMeteringEnforced } from "~/server/deployment";

export function createAppScenarioLedger(
    options: { enforced?: () => boolean } = {}
): ScenarioLedger {
    return {
        enforced: options.enforced ?? isMeteringEnforced,
        async lockBalance(tx, companyId) {
            // Creates the account (with the signup grant, where that applies)
            // the first time a workspace meets the ledger, like a debit would.
            await ensureTokenAccount(companyId, tx);
            const [row] = await tx
                .select({ balance: tokenAccounts.balanceTokens })
                .from(tokenAccounts)
                .where(eq(tokenAccounts.companyId, companyId))
                .for("update");
            return row?.balance ?? 0;
        },
        async debit(tx, input) {
            await debitTokens(
                {
                    companyId: input.companyId,
                    amount: input.amount,
                    service: "scenario_simulation",
                    description: input.description,
                    referenceId: input.referenceId,
                    metadata: input.metadata,
                    // The hold admitted this work and it is done: record it even
                    // if another feature spent the balance meanwhile.
                    allowNegative: true,
                },
                tx
            );
        },
    };
}

export function createAppScenarioCredits(
    options: { enforced?: () => boolean } = {}
): ScenarioCreditsPort {
    return createScenarioCredits(createAppScenarioLedger(options));
}
