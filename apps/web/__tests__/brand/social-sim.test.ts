/**
 * The /dev/growth harness answers every `brandApi` call from memory. The
 * Brand screens are verified against it, so its rules are pinned here:
 * what an admin and a member may do, Bluesky's app-password shape, what
 * disconnecting takes with it, and that replies and "done" stick.
 */

import {
    configureBrandSim,
    resetBrandSim,
    simulateBrand,
    simulateLinkedInConnect,
} from "~/app/dev/growth/brand-sim";
import type {
    BrandAccounts,
    BrandComment,
    BrandInsights,
    BrandPost,
} from "~/app/employer/tools/growth/brand/api";

jest.setTimeout(20_000);

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await simulateBrand(new URL(path, "http://harness.local"), init, Date.now());
    if (!response) throw new Error(`no answer for ${path}`);
    return { status: response.status, body: (await response.json()) as T };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => resetBrandSim());

describe("brand harness", () => {
    it("starts with Dana's LinkedIn (two Pages and her profile) and one Bluesky account", async () => {
        const { body } = await call<BrandAccounts>("/api/brand/accounts");
        expect(body.canManage).toBe(true);
        expect(body.connections.map(c => c.accountName)).toEqual([
            "Dana Okafor",
            "launchstack.bsky.social",
        ]);
        expect(body.channels.map(c => [c.name, c.kind, c.enabled])).toEqual([
            ["LaunchStack", "organization", true],
            ["LaunchStack Labs", "organization", false],
            ["Dana Okafor", "person", true],
            ["launchstack.bsky.social", "account", true],
        ]);
        expect(body.networks.find(n => n.platform === "x")?.setup.length).toBeGreaterThan(0);
    });

    it("a member reads but cannot change anything", async () => {
        configureBrandSim({ canManage: false });
        const { body } = await call<BrandAccounts>("/api/brand/accounts");
        expect(body.canManage).toBe(false);
        const toggled = await call("/api/brand/channels/ch-li-labs", patch({ enabled: true }));
        expect(toggled.status).toBe(403);
    });

    it("switches a channel on and off for Compose", async () => {
        const { body } = await call<{ channel: { enabled: boolean } }>(
            "/api/brand/channels/ch-li-labs",
            patch({ enabled: true })
        );
        expect(body.channel.enabled).toBe(true);
    });

    it("refuses a Bluesky sign-in that is not an app password", async () => {
        const bad = await call<{ error: string }>(
            "/api/brand/connections/bluesky",
            post({ identifier: "acme.bsky.social", appPassword: "hunter2" })
        );
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatch(/xxxx-xxxx-xxxx-xxxx/);
        const good = await call<{ channels: Array<{ name: string }> }>(
            "/api/brand/connections/bluesky",
            post({ identifier: "@Acme.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" })
        );
        expect(good.status).toBe(201);
        expect(good.body.channels[0]?.name).toBe("acme.bsky.social");
    });

    it("disconnecting takes the connection's channels with it; OAuth brings them back", async () => {
        await call("/api/brand/connections/1", { method: "DELETE" });
        let accounts = (await call<BrandAccounts>("/api/brand/accounts")).body;
        expect(accounts.channels.map(c => c.platform)).toEqual(["bluesky"]);
        expect(simulateLinkedInConnect().accountName).toBe("Dana Okafor");
        accounts = (await call<BrandAccounts>("/api/brand/accounts")).body;
        expect(accounts.channels.filter(c => c.platform === "linkedin")).toHaveLength(3);
    });

    it("publishes to channels, drops images on a text-only channel, and fails WebP on LinkedIn", async () => {
        const file = new File([new Uint8Array(10)], "photo.webp", { type: "image/webp" });
        const form = new FormData();
        form.set("file", file);
        const uploaded = await call<{ media: { id: string } }>("/api/brand/media", {
            method: "POST",
            body: form,
        });
        expect(uploaded.status).toBe(201);
        const { body } = await call<{ posts: BrandPost[] }>(
            "/api/brand/posts",
            post({
                channels: ["ch-li-launchstack", "ch-bsky-launchstack.bsky.social"],
                body: "Hello",
                media: [{ id: uploaded.body.media.id, alt: "A photo" }],
                publishNow: true,
            })
        );
        const byChannel = new Map(body.posts.map(p => [p.channelId, p]));
        expect(byChannel.get("ch-li-launchstack")?.status).toBe("failed");
        expect(byChannel.get("ch-li-launchstack")?.error).toMatch(/WebP/);
        const bsky = byChannel.get("ch-bsky-launchstack.bsky.social");
        expect(bsky?.status).toBe("published");
        expect(bsky?.media[0]?.alt).toBe("A photo");
    });

    it("insights add up the published posts in the window", async () => {
        const { body } = await call<BrandInsights>("/api/brand/insights?days=30");
        const sum = body.channels.reduce((n, c) => n + c.impressions, 0);
        expect(body.totals.impressions).toBe(sum);
        expect(body.posts.every(p => p.status === "published")).toBe(true);
        const longer = (await call<BrandInsights>("/api/brand/insights?days=90")).body;
        expect(longer.totals.posts).toBeGreaterThan(body.totals.posts);
    });

    it("sync moves the numbers and stamps the time", async () => {
        const before = (await call<BrandInsights>("/api/brand/insights?days=30")).body;
        const synced = await call<{ syncedAt: string; errors: string[] }>(
            "/api/brand/insights/sync",
            { method: "POST" }
        );
        expect(synced.body.errors).toEqual([]);
        const after = (await call<BrandInsights>("/api/brand/insights?days=30")).body;
        expect(after.totals.impressions).toBeGreaterThan(before.totals.impressions);
        expect(after.syncedAt).toBe(synced.body.syncedAt);
    });

    it("a reply is the channel's own comment under its parent; done toggles", async () => {
        const open = (await call<{ comments: BrandComment[] }>("/api/brand/comments?status=open"))
            .body.comments;
        const target = open.find(c => !c.isOwn && !c.handledAt && !c.parentId)!;
        const replied = await call<{ comment: BrandComment }>(
            `/api/brand/comments/${target.id}/reply`,
            post({ text: "Thanks!" })
        );
        expect(replied.body.comment).toMatchObject({
            parentId: target.id,
            isOwn: true,
            text: "Thanks!",
        });
        const done = await call<{ comment: BrandComment }>(
            `/api/brand/comments/${target.id}`,
            patch({ handled: true })
        );
        expect(done.body.comment.handledAt).not.toBeNull();
        const reopened = await call<{ comment: BrandComment }>(
            `/api/brand/comments/${target.id}`,
            patch({ handled: false })
        );
        expect(reopened.body.comment.handledAt).toBeNull();
    });

    it("open returns whole threads that still wait on someone", async () => {
        const open = (await call<{ comments: BrandComment[] }>("/api/brand/comments?status=open"))
            .body.comments;
        const all = (await call<{ comments: BrandComment[] }>("/api/brand/comments?status=all"))
            .body.comments;
        expect(all.length).toBeGreaterThan(open.length);
        // Priya's question was answered and marked done: her thread is not open.
        expect(open.some(c => c.authorName === "Priya Raman")).toBe(false);
        // Marcus's thread is open, with Jordan's reply under it.
        expect(open.some(c => c.authorName === "Jordan Kim")).toBe(true);
    });
});
