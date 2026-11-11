import { configureOcr } from "@launchstack/conversion/ocr/config";
import { coerceAgentDefinition } from "~/lib/agents/definition";
import { createPersona, updatePersona } from "~/server/collab/personas";
import { connectBluesky } from "~/server/brand/channels";

const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockVerifyBluesky = jest.fn();
const mockUpsertConnection = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
        insert: (...args: unknown[]) => mockInsert(...args),
        update: (...args: unknown[]) => mockUpdate(...args),
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/services/connectors/connection-store", () => ({
    upsertConnection: (...args: unknown[]) => mockUpsertConnection(...args),
}));
jest.mock("@launchstack/tools/social-publish/bluesky", () => ({
    verifyBlueskyCredentials: (...args: unknown[]) => mockVerifyBluesky(...args),
}));
jest.mock("~/env", () => ({
    env: { server: { NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example", S3_BUCKET_NAME: "files" } },
}));

const COMPANY = 7n;
const CANONICAL = "https://s3.example/files/avatars/owned.png";
const ALIAS = "https://s3.example/files/avatars/%6fwned.png";
const mockWrites: Record<string, unknown>[] = [];

function ledger(rows: Record<string, unknown>[]) {
    mockSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve(rows) }) });
}

beforeEach(() => {
    jest.clearAllMocks();
    configureOcr({});
    mockWrites.length = 0;
    ledger([{ companyId: COMPANY, url: CANONICAL, deletedAt: null }]);
    mockInsert.mockImplementation(() => ({
        values: (values: Record<string, unknown>) => {
            mockWrites.push(values);
            const returning = () => Promise.resolve([{ ...values, temperature: null }]);
            return { returning, onConflictDoUpdate: () => ({ returning }) };
        },
    }));
    mockUpdate.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
            mockWrites.push(values);
            return { where: () => ({ returning: () => Promise.resolve([values]) }) };
        },
    }));
    mockUpsertConnection.mockResolvedValue({ id: 1, companyId: COMPANY });
});

afterEach(() => configureOcr({}));

const paths = [
    {
        name: "persona creation (including a parsed definition)",
        write: (url: string) =>
            createPersona(
                COMPANY,
                coerceAgentDefinition({
                    key: "analyst",
                    displayName: "Analyst",
                    role: "Analyze",
                    systemPrompt: "Analyze",
                    avatarUrl: url,
                })
            ),
    },
    {
        name: "persona update",
        write: (url: string) => updatePersona(COMPANY, "persona_1", { avatarUrl: url }),
    },
    {
        name: "brand channel discovery/upsert",
        write: (url: string) => {
            mockVerifyBluesky.mockResolvedValue({
                did: "did:plc:1",
                handle: "test.bsky.social",
                avatarUrl: url,
            });
            return connectBluesky({
                companyId: COMPANY,
                userPk: 1n,
                identifier: "test.bsky.social",
                appPassword: "secret",
            });
        },
    },
];

describe.each(paths)("$name", ({ write }) => {
    it("rejects an alias of an owned object before writing its avatar", async () => {
        await expect(write(ALIAS)).rejects.toMatchObject({ status: 404 });
        expect(mockWrites).toEqual([]);
    });

    it("keeps an owned live ledger URL byte-identical", async () => {
        await write(CANONICAL);
        expect(mockWrites).toContainEqual(expect.objectContaining({ avatarUrl: CANONICAL }));
    });

    it("rejects a deleted ledger object", async () => {
        ledger([{ companyId: COMPANY, url: CANONICAL, deletedAt: new Date() }]);
        await expect(write(CANONICAL)).rejects.toMatchObject({ status: 404 });
        expect(mockWrites).toEqual([]);
    });

    it("keeps another provider location as an external avatar", async () => {
        const url = "https://other.public.blob.vercel-storage.com/avatar.png";
        await write(url);
        expect(mockWrites).toContainEqual(expect.objectContaining({ avatarUrl: url }));
        expect(mockSelect).not.toHaveBeenCalled();
    });
});
