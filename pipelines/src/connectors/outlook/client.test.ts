import { describe, expect, it } from "vitest";

import {
    createOutlookClient,
    OutlookApiError,
    OutlookAuthError,
    OutlookDeltaExpiredError,
    OutlookNotFoundError,
} from "./client";

interface Reply {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}

function clientWith(replies: Reply[], baseUrl?: string) {
    const requests: { url: string; prefer: string | null; authorization: string | null }[] = [];
    const sleeps: number[] = [];
    const client = createOutlookClient({
        accessToken: "token-1",
        baseUrl,
        fetch: async (url, init) => {
            const headers = new Headers(init?.headers);
            requests.push({
                url,
                prefer: headers.get("Prefer"),
                authorization: headers.get("Authorization"),
            });
            const reply = replies.shift() ?? { status: 500, body: {} };
            const body =
                reply.body instanceof Uint8Array ? reply.body : JSON.stringify(reply.body ?? {});
            return new Response(body as BodyInit, {
                status: reply.status ?? 200,
                headers: reply.headers,
            });
        },
        sleep: async ms => {
            sleeps.push(ms);
        },
    });
    return { client, requests, sleeps };
}

const BASE = "https://graph.microsoft.com/v1.0";

describe("createOutlookClient", () => {
    it("asks for text bodies and immutable ids on every request", async () => {
        const { client, requests } = clientWith([
            { body: { id: "u", mail: "me@example.com" } },
            { body: { value: [] } },
        ]);

        await client.getProfile();
        await client.listMailFolders();

        expect(requests.map(r => r.url)).toEqual([
            `${BASE}/me`,
            `${BASE}/me/mailFolders?$top=100&includeHiddenFolders=false`,
        ]);
        for (const request of requests) {
            expect(request.prefer).toBe('outlook.body-content-type="text", IdType="ImmutableId"');
            expect(request.authorization).toBe("Bearer token-1");
        }
    });

    it("pages folder listings through their next links", async () => {
        const next = `${BASE}/me/mailFolders/f%201/childFolders?$top=100&$skip=100`;
        const { client, requests } = clientWith(
            [
                { body: { value: [{ id: "a", displayName: "A" }], "@odata.nextLink": next } },
                { body: { value: [{ id: "b", displayName: "B" }] } },
            ],
            "http://localhost:4010/v1.0"
        );

        const folders = await client.listChildFolders("f 1");

        expect(folders.map(folder => folder.id)).toEqual(["a", "b"]);
        expect(requests.map(r => r.url)).toEqual([
            "http://localhost:4010/v1.0/me/mailFolders/f%201/childFolders?$top=100",
            next,
        ]);
    });

    it("starts a delta round from scratch and fetches stored links as-is", async () => {
        const deltaLink = `${BASE}/me/mailFolders/inbox/messages/delta?$deltatoken=abc`;
        const { client, requests } = clientWith([
            {
                body: {
                    value: [{ id: "m1", conversationId: "c1" }],
                    "@odata.deltaLink": deltaLink,
                },
            },
            { body: { value: [{ id: "m2", "@removed": { reason: "deleted" } }] } },
        ]);

        const first = await client.listFolderDelta({ folderId: "inbox" });
        const second = await client.listFolderDelta({ folderId: "inbox", link: deltaLink });

        expect(requests.map(r => r.url)).toEqual([
            `${BASE}/me/mailFolders/inbox/messages/delta?$select=id,conversationId,isDraft,receivedDateTime`,
            deltaLink,
        ]);
        expect(first["@odata.deltaLink"]).toBe(deltaLink);
        expect(second.value[0]!["@removed"]).toEqual({ reason: "deleted" });
    });

    it("turns 410 and sync-state error codes into OutlookDeltaExpiredError", async () => {
        const { client } = clientWith([
            { status: 410, body: { error: { code: "SyncStateNotFound", message: "gone" } } },
            { status: 400, body: { error: { code: "resyncRequired", message: "resync" } } },
        ]);

        const gone = await client
            .listFolderDelta({ folderId: "inbox", link: "https://x/delta" })
            .catch((error: unknown) => error);
        expect(gone).toBeInstanceOf(OutlookDeltaExpiredError);
        expect(gone).toMatchObject({ folderId: "inbox" });
        await expect(
            client.listFolderDelta({ folderId: "inbox", link: "https://x/delta" })
        ).rejects.toBeInstanceOf(OutlookDeltaExpiredError);
    });

    it("filters a conversation's messages and follows its pages", async () => {
        const next = `${BASE}/me/messages?$skip=50`;
        const { client, requests } = clientWith([
            { body: { value: [{ id: "m1" }], "@odata.nextLink": next } },
            { body: { value: [{ id: "m2" }] } },
        ]);

        const messages = await client.listConversationMessages("AAQk+/='x");

        expect(messages.map(entry => entry.id)).toEqual(["m1", "m2"]);
        expect(requests[0]!.url).toBe(
            `${BASE}/me/messages?$filter=conversationId%20eq%20'AAQk%2B%2F%3D''x'&$top=50` +
                "&$select=id,conversationId,subject,from,toRecipients,ccRecipients,sentDateTime," +
                "receivedDateTime,isDraft,hasAttachments,body,bodyPreview,webLink,parentFolderId," +
                "internetMessageId"
        );
        expect(requests[1]!.url).toBe(next);
    });

    it("searches with a quoted query, lists attachments and downloads their bytes", async () => {
        const { client, requests } = clientWith([
            { body: { value: [{ id: "m1", conversationId: "c1" }] } },
            { body: { value: [{ id: "att 1", name: "a.pdf", size: 3 }] } },
            { body: new Uint8Array([7, 8, 9]) },
        ]);

        const page = await client.searchMessages({ query: 'term "sheet"' });
        const attachments = await client.listAttachments("m1");
        const bytes = await client.downloadAttachment("m1", "att 1");

        expect(page.value).toHaveLength(1);
        expect(attachments[0]!.name).toBe("a.pdf");
        expect([...bytes]).toEqual([7, 8, 9]);
        expect(requests.map(r => r.url)).toEqual([
            `${BASE}/me/messages?$search=%22term%20%5C%22sheet%5C%22%22&$top=50&$select=id,conversationId,isDraft`,
            `${BASE}/me/messages/m1/attachments?$select=id,name,contentType,size,isInline`,
            `${BASE}/me/messages/m1/attachments/att%201/$value`,
        ]);
    });

    it("retries 429 and 5xx, honouring Retry-After", async () => {
        const { client, requests, sleeps } = clientWith([
            { status: 429, headers: { "Retry-After": "2" } },
            { status: 502 },
            { body: { id: "u" } },
        ]);

        expect((await client.getProfile()).id).toBe("u");
        expect(requests).toHaveLength(3);
        expect(sleeps[0]).toBe(2000);
        expect(sleeps[1]).toBeGreaterThanOrEqual(2000);
    });

    it("maps 401, 403 access denied and 404 to their error classes without retrying", async () => {
        const { client, requests } = clientWith([
            {
                status: 401,
                body: { error: { code: "InvalidAuthenticationToken", message: "expired" } },
            },
            { status: 403, body: { error: { code: "ErrorAccessDenied", message: "no scope" } } },
            { status: 404, body: { error: { code: "ErrorItemNotFound", message: "gone" } } },
            { status: 400, body: { error: { code: "BadRequest", message: "bad query" } } },
        ]);

        await expect(client.getProfile()).rejects.toMatchObject({
            name: "OutlookAuthError",
            status: 401,
        });
        const denied = await client.listMailFolders().catch((error: unknown) => error);
        expect(denied).toBeInstanceOf(OutlookAuthError);
        expect(denied).toMatchObject({ status: 403, code: "ErrorAccessDenied" });
        const missing = await client.listAttachments("m9").catch((error: unknown) => error);
        expect(missing).toBeInstanceOf(OutlookNotFoundError);
        expect(missing).toMatchObject({ resource: "message m9", status: 404 });
        const bad = await client.searchMessages({ query: "(" }).catch((error: unknown) => error);
        expect(bad).toBeInstanceOf(OutlookApiError);
        expect(bad).toMatchObject({ status: 400, message: "bad query" });
        expect(requests).toHaveLength(4);
    });
});
