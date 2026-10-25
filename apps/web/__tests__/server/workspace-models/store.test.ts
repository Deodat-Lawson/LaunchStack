/**
 * Saving a workspace's endpoint: the key is sealed before it reaches the
 * database, and a saved key is never kept for an address it wasn't entered
 * for.
 */

import { randomBytes } from "node:crypto";

import { configureSecretBox, decryptSecret } from "@launchstack/store/crypto";

const mockExisting: { current: Record<string, unknown> | null } = { current: null };
const mockWritten: Array<Record<string, unknown>> = [];

jest.mock("~/server/engine", () => ({ getEngine: () => undefined }));
jest.mock("~/server/db", () => {
    const select = () => ({
        from: () => ({
            where: () => ({
                limit: async () => (mockExisting.current ? [mockExisting.current] : []),
            }),
        }),
    });
    const insert = () => ({
        values: (values: Record<string, unknown>) => ({
            onConflictDoUpdate: () => ({
                returning: async () => {
                    mockWritten.push(values);
                    return [values];
                },
            }),
        }),
    });
    return { db: { select, insert } };
});

import {
    KeyNeededForNewAddressError,
    readWorkspaceEndpointKey,
    saveWorkspaceEndpoint,
} from "~/server/workspace-models/store";
import type { WorkspaceModelEndpointRow } from "~/server/db/schema/workspace-models";

const selection = { default: { id: "acme/chat", vision: false, reasoning: false } };
const base = {
    companyId: BigInt(5),
    userId: BigInt(7),
    provider: "custom" as const,
    models: selection,
    connectedVia: "key" as const,
};

beforeAll(() => configureSecretBox({ key: randomBytes(32).toString("base64") }));
beforeEach(() => {
    mockExisting.current = null;
    mockWritten.length = 0;
});

describe("saveWorkspaceEndpoint", () => {
    it("seals the key and keeps only its last four characters in the clear", async () => {
        await saveWorkspaceEndpoint({
            ...base,
            baseUrl: "https://a.example/v1",
            apiKey: "sk-live-0123456789abcd",
        });
        const written = mockWritten[0]!;
        expect(written.apiKeyLast4).toBe("abcd");
        expect(String(written.apiKeyCiphertext)).not.toContain("sk-live");
        expect(decryptSecret(String(written.apiKeyCiphertext))).toBe("sk-live-0123456789abcd");
        expect(readWorkspaceEndpointKey(written as unknown as WorkspaceModelEndpointRow)).toBe(
            "sk-live-0123456789abcd"
        );
    });

    it("doesn't reveal any of a short key", async () => {
        await saveWorkspaceEndpoint({ ...base, baseUrl: "https://a.example/v1", apiKey: "abc123" });
        expect(mockWritten[0]!.apiKeyLast4).toBeNull();
    });

    it("keeps the stored key when the address is unchanged", async () => {
        mockExisting.current = {
            baseUrl: "https://a.example/v1",
            apiKeyCiphertext: "sealed",
            apiKeyLast4: "abcd",
            encryptionKeyVersion: 1,
        };
        await saveWorkspaceEndpoint({
            ...base,
            baseUrl: "https://a.example/v1",
            apiKey: undefined,
        });
        expect(mockWritten[0]).toMatchObject({ apiKeyCiphertext: "sealed", apiKeyLast4: "abcd" });
    });

    it("refuses to keep the stored key for a new address", async () => {
        mockExisting.current = {
            baseUrl: "https://a.example/v1",
            apiKeyCiphertext: "sealed",
            apiKeyLast4: "abcd",
            encryptionKeyVersion: 1,
        };
        await expect(
            saveWorkspaceEndpoint({ ...base, baseUrl: "https://b.example/v1", apiKey: undefined })
        ).rejects.toThrow(KeyNeededForNewAddressError);
        expect(mockWritten).toHaveLength(0);
    });

    it("saves a keyless endpoint", async () => {
        await saveWorkspaceEndpoint({ ...base, baseUrl: "http://localhost:8000/v1", apiKey: null });
        expect(mockWritten[0]).toMatchObject({ apiKeyCiphertext: null, apiKeyLast4: null });
    });
});
