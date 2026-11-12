import { describe, expect, it } from "vitest";

import {
    createMicrosoft365Client,
    encodeSharingUrl,
    Microsoft365AccessError,
    Microsoft365ApiError,
    Microsoft365AuthError,
} from "./client";

interface Reply {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}

function fakeFetch(replies: Reply[]) {
    const requests: { url: string; authorization: string | null }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
        requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
        const reply = replies.shift() ?? { status: 500, body: {} };
        const body =
            reply.body instanceof Uint8Array ? reply.body : JSON.stringify(reply.body ?? {});
        return new Response(body as BodyInit, {
            status: reply.status ?? 200,
            headers: reply.headers,
        });
    };
    return { fetchImpl, requests };
}

function clientWith(replies: Reply[], baseUrl?: string) {
    const { fetchImpl, requests } = fakeFetch(replies);
    const sleeps: number[] = [];
    const client = createMicrosoft365Client({
        accessToken: "token-1",
        baseUrl,
        fetch: fetchImpl,
        sleep: async ms => {
            sleeps.push(ms);
        },
    });
    return { client, requests, sleeps };
}

describe("createMicrosoft365Client", () => {
    it("encodes a sharing URL as an unpadded base64url share token", () => {
        const url = "https://contoso.sharepoint.com/:w:/s/team/EaBc?e=1";
        const token = encodeSharingUrl(url);
        expect(token.startsWith("u!")).toBe(true);
        expect(token).not.toMatch(/[=+/]/);
        expect(Buffer.from(token.slice(2), "base64url").toString("utf8")).toBe(url);
    });

    it("addresses items and the drive root, with the bearer token", async () => {
        const { client, requests } = clientWith(
            [{ body: { id: "root-id", name: "root" } }, { body: { id: "i 1", name: "a.docx" } }],
            "http://localhost:4010/v1.0/"
        );

        await client.getItem("b!d", "root");
        await client.getItem("b!d", "i 1");

        expect(requests.map(r => r.url)).toEqual([
            "http://localhost:4010/v1.0/drives/b!d/root",
            "http://localhost:4010/v1.0/drives/b!d/items/i%201",
        ]);
        expect(requests[0]!.authorization).toBe("Bearer token-1");
    });

    it("lists children with $top and fetches a next link as-is", async () => {
        const next = "https://graph.microsoft.com/v1.0/drives/b!d/items/f/children?$skiptoken=abc";
        const { client, requests } = clientWith([
            { body: { value: [{ id: "1", name: "a" }], "@odata.nextLink": next } },
            { body: { value: [{ id: "2", name: "b" }] } },
        ]);

        const first = await client.listChildren("b!d", "f");
        const second = await client.listChildren("b!d", "f", first["@odata.nextLink"]);

        expect(requests.map(r => r.url)).toEqual([
            "https://graph.microsoft.com/v1.0/drives/b!d/items/f/children?$top=200",
            next,
        ]);
        expect(second.value.map(item => item.id)).toEqual(["2"]);
        expect(second["@odata.nextLink"]).toBeUndefined();
    });

    it("downloads bytes and resolves share links, sites and their libraries", async () => {
        const { client, requests } = clientWith([
            { body: new Uint8Array([1, 2, 3]) },
            { body: { id: "shared", name: "s.docx" } },
            { body: { value: [{ id: "site,1", displayName: "Team" }] } },
            { body: { value: [{ id: "b!lib", name: "Documents", driveType: "documentLibrary" }] } },
        ]);

        expect([...(await client.download("b!d", "f"))]).toEqual([1, 2, 3]);
        expect((await client.getSharedItem("https://x/y")).id).toBe("shared");
        expect((await client.searchSites("team site"))[0]!.displayName).toBe("Team");
        expect((await client.listSiteDrives("site,1"))[0]!.id).toBe("b!lib");

        expect(requests.map(r => r.url)).toEqual([
            "https://graph.microsoft.com/v1.0/drives/b!d/items/f/content",
            `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl("https://x/y")}/driveItem`,
            "https://graph.microsoft.com/v1.0/sites?search=team%20site",
            "https://graph.microsoft.com/v1.0/sites/site%2C1/drives",
        ]);
    });

    it("retries 429 and 5xx, honouring Retry-After", async () => {
        const { client, requests, sleeps } = clientWith([
            {
                status: 429,
                headers: { "Retry-After": "3" },
                body: { error: { code: "tooManyRequests" } },
            },
            { status: 503, body: {} },
            { body: { id: "d", driveType: "business" } },
        ]);

        expect((await client.getMyDrive()).id).toBe("d");
        expect(requests).toHaveLength(3);
        expect(sleeps[0]).toBe(3000);
        expect(sleeps[1]).toBeGreaterThanOrEqual(2000);
    });

    it("gives up after maxAttempts with the last status", async () => {
        const { fetchImpl } = fakeFetch([{ status: 503 }, { status: 503 }]);
        const client = createMicrosoft365Client({
            accessToken: "t",
            fetch: fetchImpl,
            maxAttempts: 2,
            sleep: async () => undefined,
        });

        await expect(client.getMyDrive()).rejects.toMatchObject({
            name: "Microsoft365ApiError",
            status: 503,
        });
    });

    it("maps 401, 403 accessDenied and 404 to their error classes", async () => {
        const { client, requests } = clientWith([
            {
                status: 401,
                body: { error: { code: "InvalidAuthenticationToken", message: "expired" } },
            },
            { status: 403, body: { error: { code: "accessDenied", message: "no" } } },
            { status: 404, body: { error: { code: "itemNotFound", message: "gone" } } },
            { status: 403, body: { error: { code: "notAllowed", message: "policy" } } },
        ]);

        await expect(client.getItem("d", "a")).rejects.toBeInstanceOf(Microsoft365AuthError);
        const denied = await client.getItem("d", "b").catch((error: unknown) => error);
        expect(denied).toBeInstanceOf(Microsoft365AccessError);
        expect(denied).toMatchObject({ resource: "d:b", status: 403 });
        await expect(client.getItem("d", "c")).rejects.toMatchObject({
            name: "Microsoft365AccessError",
            status: 404,
        });
        const other = await client.getItem("d", "e").catch((error: unknown) => error);
        expect(other).toBeInstanceOf(Microsoft365ApiError);
        expect(other).toMatchObject({ status: 403, code: "notAllowed", message: "policy" });
        // None of these were retried.
        expect(requests).toHaveLength(4);
    });
});
