/**
 * debitTokens in "record" mode — the self-hosted default.
 *
 * Both cases here are regressions caught in review of the metering split, and
 * both had the same shape: usage silently not recorded, with no error anywhere.
 *
 *  1. The signup grant is cloud-only, so a self-hosted account opens at zero.
 *     A debit that kept the `balance >= amount` guard would therefore match no
 *     rows on the very first chat message and record nothing, forever.
 *
 *  2. hasTokens() used to be the only caller of ensureTokenAccount(). Once the
 *     balance check stopped running outside enforce mode, a workspace that
 *     predates the ledger had no account row, and the UPDATE matched nothing.
 *
 * The fix for both is in debitTokens rather than at each call site: it defaults
 * allowNegative from the deployment policy, and creates a missing row and
 * retries when recording.
 */

const mockUpdateWhere = jest.fn();
const mockUpdateReturning = jest.fn();
const mockInsertValues = jest.fn();
const mockSelectWhere = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
        insert: () => ({ values: mockInsertValues }),
        select: () => ({ from: () => ({ where: mockSelectWhere }) }),
    },
}));

jest.mock("~/server/deployment", () => ({
    isMeteringEnforced: jest.fn(() => false),
}));

import { debitTokens } from "~/lib/credits/service";
import { isMeteringEnforced } from "~/server/deployment";

const mockIsMeteringEnforced = isMeteringEnforced as jest.Mock;

/** Rows the UPDATE ... RETURNING resolves to, in call order. */
function updateReturns(...batches: Array<Array<{ newBalance: number }>>) {
    let call = 0;
    mockUpdateWhere.mockImplementation(() => ({
        returning: () => {
            const batch = batches[Math.min(call, batches.length - 1)] ?? [];
            call += 1;
            return Promise.resolve(batch);
        },
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockIsMeteringEnforced.mockReturnValue(false);
    // Transaction + daily-usage inserts, and the account-creation insert.
    mockInsertValues.mockReturnValue({
        onConflictDoUpdate: () => Promise.resolve(),
        onConflictDoNothing: () => Promise.resolve(),
        then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
    });
    // ensureTokenAccount's balance lookup and existence check.
    mockSelectWhere.mockResolvedValue([]);
    mockUpdateReturning.mockResolvedValue([]);
});

describe("debitTokens in record mode", () => {
    // Which SQL branch runs is asserted indirectly, via the retry behaviour
    // below — only the unguarded branch can ensure-and-retry, and only the
    // guarded one returns null without retrying. Comparing the drizzle
    // conditions directly would couple this test to library internals.
    it("consults the deployment policy when the caller says nothing", async () => {
        updateReturns([{ newBalance: -120 }]);

        const result = await debitTokens({
            companyId: 7n,
            amount: 120,
            service: "llm_chat",
            description: "Chat query",
        });

        // The regression: debitTokens used to take the guarded branch for every
        // caller that did not opt out, so the chat route — which debits directly
        // rather than through the credits port — recorded nothing on a
        // zero-balance self-hosted account. A negative balance is the point here:
        // it reads as net usage, and lifetimeTokensUsed climbs.
        expect(mockIsMeteringEnforced).toHaveBeenCalled();
        expect(result).toEqual({ newBalance: -120 });
        expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    });

    it("lets an explicit allowNegative skip the policy lookup", async () => {
        updateReturns([{ newBalance: -1 }]);

        await debitTokens({
            companyId: 7n,
            amount: 1,
            service: "llm_chat",
            description: "Chat query",
            allowNegative: false,
        });

        expect(mockIsMeteringEnforced).not.toHaveBeenCalled();
    });

    it("creates a missing account row and retries rather than dropping usage", async () => {
        // First UPDATE matches nothing (no row); the retry succeeds.
        updateReturns([], [{ newBalance: -40 }]);

        const result = await debitTokens({
            companyId: 9n,
            amount: 40,
            service: "embedding",
            description: "Embedding batch",
        });

        expect(result).toEqual({ newBalance: -40 });
        expect(mockUpdateWhere).toHaveBeenCalledTimes(2);
        // The row was opened at zero, not granted a notional signup bonus.
        expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 9n, balanceTokens: 0 })
        );
    });

    it("gives up after one retry instead of looping", async () => {
        updateReturns([]);

        const result = await debitTokens({
            companyId: 11n,
            amount: 10,
            service: "ner",
            description: "NER",
        });

        expect(result).toBeNull();
        expect(mockUpdateWhere).toHaveBeenCalledTimes(2);
    });
});

describe("debitTokens under enforcement", () => {
    it("still refuses to overdraw", async () => {
        mockIsMeteringEnforced.mockReturnValue(true);
        updateReturns([]);

        const result = await debitTokens({
            companyId: 7n,
            amount: 500,
            service: "llm_chat",
            description: "Chat query",
        });

        expect(result).toBeNull();
        // No ensure-and-retry: the guarded UPDATE matching nothing means
        // insufficient balance, and retrying would defeat the guard.
        expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    });

    it("honours an explicit allowNegative over the deployment default", async () => {
        mockIsMeteringEnforced.mockReturnValue(true);
        updateReturns([{ newBalance: -5 }]);

        const result = await debitTokens({
            companyId: 7n,
            amount: 5,
            service: "llm_chat",
            description: "Chat query",
            allowNegative: true,
        });

        expect(result).toEqual({ newBalance: -5 });
    });
});
