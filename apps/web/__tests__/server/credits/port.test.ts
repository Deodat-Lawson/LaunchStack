/**
 * The host's CreditsPort charges an embedding debit in chat-token equivalents
 * (by the model's price), keeps what was embedded in the entry's metadata,
 * and passes every other service through unchanged.
 */

jest.mock("~/env", () => ({
    env: {
        server: {
            AI_USAGE_CHAT_PRICE_PER_MTOK: undefined,
            AI_USAGE_EMBEDDING_PRICE_PER_MTOK: undefined,
            AI_USAGE_WEB_SEARCH_PRICE_PER_1K: undefined,
        },
    },
}));
// No declared model price: a standard chat token is $1.00 per million.
jest.mock("~/server/chat-models", () => ({
    getAppChatModelsConfig: () => ({ models: new Map(), routes: { default: "primary" } }),
}));
const mockDebitTokens = jest.fn();
jest.mock("~/lib/credits", () => ({
    debitTokens: (...args: unknown[]) => mockDebitTokens(...args) as unknown,
}));

import { createAppCreditsPort } from "~/server/credits/port";

beforeEach(() => {
    mockDebitTokens.mockReset();
    mockDebitTokens.mockResolvedValue({ newBalance: 0 });
});

describe("createAppCreditsPort", () => {
    it("charges an embedding at its weight and keeps the tokens embedded", async () => {
        const metadata = {
            estimatedTokens: 1_000_000,
            chunks: 40,
            model: "text-embedding-3-large",
        };
        await createAppCreditsPort().debit({
            companyId: 7n,
            service: "embedding",
            tokens: 1_000_000,
            description: "Embed 40 chunks for document 12",
            referenceId: "12",
            metadata,
        });

        expect(mockDebitTokens).toHaveBeenCalledTimes(1);
        expect(mockDebitTokens).toHaveBeenCalledWith({
            companyId: 7n,
            amount: 130_000,
            service: "embedding",
            description: "Embed 40 chunks for document 12",
            referenceId: "12",
            metadata: { ...metadata, embeddedTokens: 1_000_000 },
        });
    });

    it("prices the debit by the model named in its metadata", async () => {
        await createAppCreditsPort().debit({
            companyId: 7n,
            service: "embedding",
            tokens: 1_000_000,
            metadata: { model: "openai/text-embedding-3-small" },
        });
        expect(mockDebitTokens).toHaveBeenCalledWith(
            expect.objectContaining({
                amount: 20_000,
                description: "embedding usage",
                metadata: { model: "openai/text-embedding-3-small", embeddedTokens: 1_000_000 },
            })
        );
    });

    it("charges at least 1, at the default price when no model is named", async () => {
        const port = createAppCreditsPort();
        await port.debit({ companyId: 7n, service: "embedding", tokens: 3 });
        await port.debit({ companyId: 7n, service: "embedding", tokens: 10_000 });

        expect(
            mockDebitTokens.mock.calls.map(([call]) => (call as { amount: number }).amount)
        ).toEqual([1, 1_300]);
        expect(mockDebitTokens.mock.calls[0]![0]).toMatchObject({
            metadata: { embeddedTokens: 3 },
        });
    });

    it("passes every other service through untouched", async () => {
        const metadata = { model: "text-embedding-3-large", entities: 12 };
        await createAppCreditsPort().debit({
            companyId: 7n,
            service: "ner",
            tokens: 5_000,
            metadata,
        });

        expect(mockDebitTokens).toHaveBeenCalledWith({
            companyId: 7n,
            amount: 5_000,
            service: "ner",
            description: "ner usage",
            referenceId: undefined,
            metadata,
        });
        expect((mockDebitTokens.mock.calls[0]![0] as { metadata: unknown }).metadata).toBe(
            metadata
        );
    });

    it("never throws when the ledger write fails", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        mockDebitTokens.mockRejectedValue(new Error("database is down"));
        await expect(
            createAppCreditsPort().debit({ companyId: 7n, service: "embedding", tokens: 100 })
        ).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
