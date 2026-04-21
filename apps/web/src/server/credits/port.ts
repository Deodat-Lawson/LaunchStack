/**
 * Concrete CreditsPort implementation that wraps the app's existing token
 * service (~/lib/credits). This is what apps/web hands to createEngine so
 * core subsystems can debit per-company balances without importing the
 * Drizzle tokenAccounts tables directly.
 *
 * Bookkeeping errors are already non-blocking in core's creditsDebitSafe
 * helper, but we also defensively wrap debitTokens here so that any
 * unexpected throw surfaces as a warning rather than breaking the caller.
 */

import type { CreditsPort, DebitInput } from "@launchstack/core/credits";
import { debitTokens } from "~/lib/credits";

export function createAppCreditsPort(): CreditsPort {
  return {
    async debit(input: DebitInput): Promise<void> {
      try {
        await debitTokens({
          companyId: input.companyId,
          amount: input.tokens,
          service: input.service,
          description: input.description ?? `${input.service} usage`,
          referenceId: input.referenceId,
          metadata: input.metadata,
        });
      } catch (err) {
        console.warn("[CreditsPort] debitTokens failed (non-blocking):", err);
      }
    },
  };
}
