/**
 * Hand-made OAuth clients (Gemini Enterprise). The queries run through a real
 * Drizzle builder over a recording proxy, so what is pinned is the SQL the
 * service sends: every read and delete is scoped to the workspace's
 * reference id, the list never selects the secret, and a new client is
 * handed from its creator to the workspace.
 */

import type * as PgProxy from "drizzle-orm/pg-proxy";
import { APIError } from "better-auth/api";

interface Query {
    sql: string;
    params: unknown[];
}
const mockQueries: Query[] = [];
/** Rows each successive query answers with (positional, as pg-proxy expects), or an error it throws. */
const mockAnswers: (unknown[][] | Error)[] = [];

jest.mock("~/server/db", () => {
    const { drizzle } = jest.requireActual<typeof PgProxy>("drizzle-orm/pg-proxy");
    return {
        db: drizzle(async (sql: string, params: unknown[]) => {
            mockQueries.push({ sql, params });
            const answer = mockAnswers.shift() ?? [];
            if (answer instanceof Error) throw answer;
            return { rows: answer };
        }),
    };
});

const mockAdminCreate = jest.fn();
jest.mock("~/server/auth", () => ({
    auth: { api: { adminCreateOAuthClient: (...args: unknown[]) => mockAdminCreate(...args) } },
}));

import {
    OAUTH_CLIENTS_PER_WORKSPACE,
    OAuthClientInputError,
    OAuthClientLimitError,
    createManualClient,
    deleteManualClient,
    listManualClients,
    oauthEndpoints,
} from "~/server/mcp/oauth-clients";

const REDIRECT = "https://vertexaisearch.cloud.google.com/oauth-redirect";
const CREATED_AT = "2026-10-16T10:00:00.000Z";
/** clientId, name, redirectUris, authMethod, createdAt — the summary's column order. */
const row = (clientId: string, name = "Gemini Enterprise") => [
    clientId,
    name,
    [REDIRECT],
    "client_secret_post",
    CREATED_AT,
];

beforeEach(() => {
    mockQueries.length = 0;
    mockAnswers.length = 0;
    mockAdminCreate.mockReset();
});

describe("oauthEndpoints", () => {
    it("names better-auth's real paths under /api/auth", () => {
        expect(oauthEndpoints("https://ls.example.com")).toEqual({
            issuer: "https://ls.example.com/api/auth",
            authorization: "https://ls.example.com/api/auth/oauth2/authorize",
            token: "https://ls.example.com/api/auth/oauth2/token",
            discovery: "https://ls.example.com/api/auth/.well-known/openid-configuration",
            scopes: "openid offline_access launchstack:read launchstack:write",
        });
    });
});

describe("listManualClients", () => {
    it("reads only this workspace's clients and never the secret column", async () => {
        mockAnswers.push([row("AbC")]);
        const clients = await listManualClients({ companyId: 50n });
        expect(clients).toEqual([
            {
                clientId: "AbC",
                name: "Gemini Enterprise",
                redirectUris: [REDIRECT],
                authMethod: "client_secret_post",
                createdAt: CREATED_AT,
            },
        ]);
        const [query] = mockQueries;
        expect(query!.sql).toMatch(/where "pdr_ai_v2_auth_oauth_client"\."reference_id" = \$1/);
        expect(query!.params).toEqual(["50"]);
        expect(query!.sql).not.toMatch(/client_secret"/);
    });
});

describe("createManualClient", () => {
    const input = {
        headers: new Headers({ cookie: "session=admin" }),
        companyId: 50n,
        name: " Gemini Enterprise ",
        redirectUris: [REDIRECT],
        authMethod: "client_secret_post" as const,
    };

    it("creates a confidential client through better-auth, then gives it to the workspace", async () => {
        mockAnswers.push([[0]]); // count
        mockAdminCreate.mockResolvedValue({ client_id: "NewClient", client_secret: "s3cret" });
        mockAnswers.push([row("NewClient")]); // update … returning

        const result = await createManualClient(input);

        expect(mockAdminCreate).toHaveBeenCalledWith({
            headers: input.headers,
            body: expect.objectContaining({
                client_name: "Gemini Enterprise",
                redirect_uris: [REDIRECT],
                token_endpoint_auth_method: "client_secret_post",
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                application_type: "web",
                scope: "openid profile email offline_access launchstack:read launchstack:write",
            }),
        });
        const update = mockQueries[1]!;
        expect(update.sql).toMatch(
            /^update "pdr_ai_v2_auth_oauth_client" set "user_id" = \$1, "reference_id" = \$2/
        );
        expect(update.params.slice(0, 3)).toEqual([null, "50", "NewClient"]);

        // The secret comes back once, beside the summary, and the summary has none.
        expect(result.clientSecret).toBe("s3cret");
        expect(result.client).toEqual({
            clientId: "NewClient",
            name: "Gemini Enterprise",
            redirectUris: [REDIRECT],
            authMethod: "client_secret_post",
            createdAt: CREATED_AT,
        });
        expect(JSON.stringify(result.client)).not.toMatch(/secret"/i);
    });

    it("stops at the workspace limit without asking better-auth", async () => {
        mockAnswers.push([[OAUTH_CLIENTS_PER_WORKSPACE]]);
        await expect(createManualClient(input)).rejects.toBeInstanceOf(OAuthClientLimitError);
        expect(mockAdminCreate).not.toHaveBeenCalled();
        expect(mockQueries[0]!.params).toEqual(["50"]);
    });

    it("turns better-auth's 400 into an input error with its reason", async () => {
        mockAnswers.push([[0]]);
        mockAdminCreate.mockRejectedValue(
            new APIError("BAD_REQUEST", {
                error: "invalid_redirect_uri",
                error_description: "web clients require https redirect URIs",
            })
        );
        const failure = createManualClient(input);
        await expect(failure).rejects.toBeInstanceOf(OAuthClientInputError);
        await expect(failure).rejects.toThrow("web clients require https redirect URIs");
    });

    it("deletes the new client again if it cannot be handed to the workspace", async () => {
        mockAnswers.push([[0]]);
        mockAdminCreate.mockResolvedValue({ client_id: "Orphan", client_secret: "s3cret" });
        mockAnswers.push(new Error("connection reset")); // the hand-over fails
        mockAnswers.push([]); // the clean-up delete
        await expect(createManualClient(input)).rejects.toThrow(/Failed query: update/);
        // No secret leaves for a client nobody could list or delete from Settings.
        const cleanup = mockQueries[2]!;
        expect(cleanup.sql).toMatch(
            /^delete from "pdr_ai_v2_auth_oauth_client" where "pdr_ai_v2_auth_oauth_client"\."client_id" = \$1/
        );
        expect(cleanup.params).toEqual(["Orphan"]);
    });
});

describe("deleteManualClient", () => {
    it("matches the client id and this workspace's reference together", async () => {
        mockAnswers.push([["AbC"]]);
        await expect(deleteManualClient({ companyId: 50n, clientId: "AbC" })).resolves.toBe(true);
        const [query] = mockQueries;
        expect(query!.sql).toMatch(
            /^delete from "pdr_ai_v2_auth_oauth_client" where \("pdr_ai_v2_auth_oauth_client"\."client_id" = \$1 and "pdr_ai_v2_auth_oauth_client"\."reference_id" = \$2\)/
        );
        expect(query!.params).toEqual(["AbC", "50"]);
    });

    it("is false for another workspace's client (no row matched)", async () => {
        mockAnswers.push([]);
        await expect(deleteManualClient({ companyId: 51n, clientId: "AbC" })).resolves.toBe(false);
    });
});
