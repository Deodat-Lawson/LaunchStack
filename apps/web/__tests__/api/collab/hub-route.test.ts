/**
 * The hub mounted on the Next.js app.
 *
 * A worker signs the canonical `/collab/v1/…` path, but the request arrives at
 * `/api/collab/hub/collab/v1/…`. If the route rebuilds that path even slightly
 * differently — dropping the query string, say — every signature fails and
 * remote agents silently stop working. That reconstruction is what this covers,
 * end to end, against a real `MeetingHub`.
 */

import {
    COLLAB_API_PREFIX,
    InMemoryChannelStore,
    MeetingHub,
    signRequest,
} from "@launchstack/collab";

const SECRET = "route-mount-secret";

const mockCtx: { hub: MeetingHub | null; store: InMemoryChannelStore } = {
    hub: null,
    store: new InMemoryChannelStore(),
};

jest.mock("~/server/collab/runtime", () => ({
    getHub: () => mockCtx.hub,
}));

import { GET, POST } from "~/app/api/collab/hub/[...path]/route";

function mountedRequest(method: string, canonicalPath: string, body: unknown, nodeId = "worker-b") {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = signRequest({
        secret: SECRET,
        method,
        path: canonicalPath,
        body: payload,
        nodeId,
    });
    // What the browser/worker actually requests: mount prefix + canonical path.
    const url = `https://app.example.com/api/collab/hub${canonicalPath}`;
    return new Request(url, {
        method,
        headers,
        body: method === "GET" ? undefined : payload,
    });
}

/** Next hands the catch-all the segments *after* the mount. */
function segments(canonicalPath: string) {
    const path = canonicalPath.split("?")[0]!;
    return { params: Promise.resolve({ path: path.split("/").filter(Boolean) }) };
}

describe("POST /api/collab/hub/[...path]", () => {
    beforeEach(() => {
        mockCtx.store = new InMemoryChannelStore();
        mockCtx.hub = new MeetingHub({ store: mockCtx.store, secret: SECRET, hubId: "app-hub" });
    });

    afterEach(() => {
        mockCtx.hub?.close();
    });

    it("registers a node through the mount", async () => {
        const path = `${COLLAB_API_PREFIX}/nodes/register`;
        const response = await POST(
            mountedRequest("POST", path, { nodeId: "worker-b", personaIds: ["eng"] }),
            segments(path)
        );

        expect(response.status).toBe(200);
        expect((await response.json()) as { hubId: string }).toMatchObject({
            ok: true,
            hubId: "app-hub",
        });
        expect(mockCtx.hub!.listNodes()).toEqual([
            expect.objectContaining({ nodeId: "worker-b", personaIds: ["eng"], connected: true }),
        ]);
    });

    it("serves the unauthenticated health probe", async () => {
        const path = `${COLLAB_API_PREFIX}/health`;
        const response = await GET(
            new Request(`https://app.example.com/api/collab/hub${path}`),
            segments(path)
        );
        expect(response.status).toBe(200);
        expect((await response.json()) as { hubId: string }).toMatchObject({ hubId: "app-hub" });
    });

    it("preserves the query string, which the signature covers", async () => {
        const channel = await mockCtx.store.createChannel({
            id: "chan_1",
            slug: "review",
            name: "Review",
            workspaceId: "7",
        });
        for (const text of ["one", "two", "three"]) {
            await mockCtx.store.append({
                channelId: channel.id,
                author: { kind: "agent", id: "pm", displayName: "Priya" },
                text,
            });
        }

        const path = `${COLLAB_API_PREFIX}/channels/chan_1/messages?afterSeq=2`;
        const response = await GET(mountedRequest("GET", path, undefined), segments(path));

        expect(response.status).toBe(200);
        const body = (await response.json()) as { messages: Array<{ text: string }> };
        expect(body.messages.map(m => m.text)).toEqual(["three"]);
    });

    it("rejects an unsigned request", async () => {
        const path = `${COLLAB_API_PREFIX}/nodes/register`;
        const response = await POST(
            new Request(`https://app.example.com/api/collab/hub${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ nodeId: "worker-b", personaIds: [] }),
            }),
            segments(path)
        );
        expect(response.status).toBe(401);
    });

    it("rejects a signature made for a different path", async () => {
        const signedFor = `${COLLAB_API_PREFIX}/channels/chan_1/messages?afterSeq=0`;
        const requestedPath = `${COLLAB_API_PREFIX}/channels/chan_1/messages?afterSeq=99`;
        const headers = signRequest({
            secret: SECRET,
            method: "GET",
            path: signedFor,
            body: "",
            nodeId: "worker-b",
        });

        const response = await GET(
            new Request(`https://app.example.com/api/collab/hub${requestedPath}`, { headers }),
            segments(requestedPath)
        );
        expect(response.status).toBe(401);
    });

    it("answers 503 — not 500 — when distributed agents are switched off", async () => {
        mockCtx.hub = null;
        const path = `${COLLAB_API_PREFIX}/nodes/register`;
        const response = await POST(
            mountedRequest("POST", path, { nodeId: "worker-b", personaIds: [] }),
            segments(path)
        );

        expect(response.status).toBe(503);
        expect(((await response.json()) as { error: string }).error).toMatch(/COLLAB_HUB_SECRET/);
    });
});
