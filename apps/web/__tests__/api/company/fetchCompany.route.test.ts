/**
 * `GET /api/fetchCompany` feeds Settings › Processing: the embedding index,
 * the tail of each stored provider key and the self-hosted endpoint. It used
 * to answer any member, a Guest included, and to carry the legacy employer and
 * employee passkeys besides. Only `settings.manage` reads it now, and the
 * passkeys are not selected at all.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET } from "~/app/api/fetchCompany/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

/** The stored row, secrets and all. The route sees only the columns it selects. */
const STORED = {
    id: 5,
    name: "Acme",
    description: "Widgets",
    industry: "Manufacturing",
    embeddingIndexKey: "ollama-768",
    employerpasskey: "EMPLOYER-SECRET",
    employeepasskey: "EMPLOYEE-SECRET",
    numberOfEmployees: "12",
    useUploadThing: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
};

const mockSelected: string[][] = [];

jest.mock("~/server/db/index", () => ({
    db: {
        select: (fields: Record<string, unknown>) => {
            const keys = Object.keys(fields);
            mockSelected.push(keys);
            const row = Object.fromEntries(
                keys.map(key => [key, (STORED as Record<string, unknown>)[key]])
            );
            const builder: Record<string, unknown> = {
                then: (resolve: (value: unknown) => unknown) => resolve([row]),
            };
            for (const method of ["from", "where", "limit"]) builder[method] = () => builder;
            return builder;
        },
    },
}));

const mockGetRedactedCredentials = jest.fn();
jest.mock("@launchstack/llm/embeddings", () => ({
    getRedactedCredentials: (companyId: number) => mockGetRedactedCredentials(companyId),
}));

function signInAs(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId: BigInt(5) }),
    });
}

describe("GET /api/fetchCompany", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelected.length = 0;
        mockGetRedactedCredentials.mockResolvedValue({
            openAI: { hasKey: true, last4: "9xQz" },
            openAIBaseUrl: "https://embeddings.example/v1",
            huggingFace: { hasKey: false, last4: null },
            ollamaBaseUrl: "http://gpu-box.internal:11434",
            ollamaModel: "nomic-embed-text",
        });
    });

    it.each(["member", "viewer", "guest"])("refuses a %s before reading anything", async role => {
        signInAs(role);

        const response = await GET();

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "Forbidden",
            permission: "settings.manage",
        });
        expect(mockSelected).toHaveLength(0);
        expect(mockGetRedactedCredentials).not.toHaveBeenCalled();
    });

    it("passes a signed-out caller's 401 through", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });

        expect((await GET()).status).toBe(401);
    });

    it.each(["owner", "admin"])(
        "gives an %s what Processing shows, and no passkeys",
        async role => {
            signInAs(role);

            const response = await GET();

            expect(response.status).toBe(200);
            const body = (await response.json()) as Record<string, unknown>;
            expect(body).toMatchObject({
                id: 5,
                embeddingIndexKey: "ollama-768",
                embeddingOpenAIApiKey: { hasKey: true, last4: "9xQz" },
                // The endpoint the key belongs to is not a secret; the form shows it.
                embeddingOpenAIBaseUrl: "https://embeddings.example/v1",
                embeddingHuggingFaceApiKey: { hasKey: false, last4: null },
                embeddingOllamaBaseUrl: "http://gpu-box.internal:11434",
                embeddingOllamaModel: "nomic-embed-text",
            });
            expect(body).not.toHaveProperty("employerpasskey");
            expect(body).not.toHaveProperty("employeepasskey");
            expect(JSON.stringify(body)).not.toMatch(/EMPLOYER-SECRET|EMPLOYEE-SECRET/);
            // Not selected, rather than selected and dropped.
            expect(mockSelected.flat()).not.toEqual(
                expect.arrayContaining([expect.stringMatching(/passkey/i)])
            );
            expect(mockGetRedactedCredentials).toHaveBeenCalledWith(5);
        }
    );

    it("lets a custom role that holds settings.manage read it", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                role: "ops-lead",
                permissions: ["documents.read", "settings.manage"],
                companyId: BigInt(5),
            }),
        });

        expect((await GET()).status).toBe(200);
    });
});
