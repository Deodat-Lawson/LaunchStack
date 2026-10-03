/**
 * Growth › Brand: how numbers are printed and sorted (a number the network
 * does not report is "—" and sorts last), and how comments become an inbox
 * of threads grouped by post.
 */

import {
    compact,
    count,
    engagementOf,
    percent,
    sortRows,
} from "~/app/employer/tools/growth/brand/_lib/numbers";
import { groupComments, isOpen, openCount } from "~/app/employer/tools/growth/brand/_lib/threads";
import type { BrandComment } from "~/app/employer/tools/growth/brand/api";

describe("number formatting", () => {
    it("count prints separators and a dash for null", () => {
        expect(count(1284)).toBe("1,284");
        expect(count(0)).toBe("0");
        expect(count(null)).toBe("—");
        expect(count(undefined)).toBe("—");
    });

    it("compact keeps small numbers whole and shortens big ones", () => {
        expect(compact(9_999)).toBe("9,999");
        expect(compact(12_400)).toBe("12.4K");
        expect(compact(1_250_000)).toBe("1.3M");
        expect(compact(null)).toBe("—");
    });

    it("percent shows one decimal under ten percent", () => {
        expect(percent(0.0423)).toBe("4.2%");
        expect(percent(0.125)).toBe("13%");
        expect(percent(0)).toBe("0.0%");
        expect(percent(null)).toBe("—");
    });
});

describe("engagementOf", () => {
    const base = { reactions: 10, comments: 5, shares: 3, clicks: 2 };

    it("uses the network's own rate when it gives one", () => {
        expect(engagementOf({ ...base, impressions: 1000, engagement: 0.5 })).toBe(0.5);
    });

    it("otherwise interactions over impressions", () => {
        expect(engagementOf({ ...base, impressions: 200, engagement: null })).toBeCloseTo(0.1);
    });

    it("no impressions, no rate", () => {
        expect(engagementOf({ ...base, impressions: null, engagement: null })).toBeNull();
        expect(engagementOf({ ...base, impressions: 0, engagement: null })).toBeNull();
        expect(engagementOf(null)).toBeNull();
    });
});

describe("sortRows", () => {
    const rows = [
        { id: "a", n: 3 as number | null, s: "beta" },
        { id: "b", n: null, s: "alpha" },
        { id: "c", n: 10, s: "gamma" },
        { id: "d", n: 3, s: "delta" },
    ];

    it("sorts numbers either way with nulls last both times", () => {
        expect(sortRows(rows, r => r.n, "desc").map(r => r.id)).toEqual(["c", "a", "d", "b"]);
        expect(sortRows(rows, r => r.n, "asc").map(r => r.id)).toEqual(["a", "d", "c", "b"]);
    });

    it("sorts strings", () => {
        expect(sortRows(rows, r => r.s, "asc").map(r => r.id)).toEqual(["b", "a", "d", "c"]);
    });

    it("does not touch the input", () => {
        sortRows(rows, r => r.n, "desc");
        expect(rows.map(r => r.id)).toEqual(["a", "b", "c", "d"]);
    });
});

function comment(id: string, patch: Partial<BrandComment> = {}): BrandComment {
    return {
        id,
        channelId: "ch-1",
        platform: "linkedin",
        postId: "p-1",
        postExcerpt: "Post one",
        postUrl: "https://www.linkedin.com/feed/update/1",
        parentId: null,
        authorName: id,
        authorHandle: null,
        text: `text of ${id}`,
        createdAt: "2026-10-01T10:00:00Z",
        isOwn: false,
        handledAt: null,
        ...patch,
    };
}

describe("comment threads", () => {
    it("open means someone else's comment nobody marked done", () => {
        expect(isOpen(comment("a"))).toBe(true);
        expect(isOpen(comment("a", { handledAt: "2026-10-02T00:00:00Z" }))).toBe(false);
        expect(isOpen(comment("a", { isOwn: true }))).toBe(false);
    });

    it("nests replies (and replies to replies) under the comment that started the thread", () => {
        const list = [
            comment("reply-2", { parentId: "reply-1", createdAt: "2026-10-01T12:00:00Z" }),
            comment("root", { createdAt: "2026-10-01T10:00:00Z" }),
            comment("reply-1", {
                parentId: "root",
                isOwn: true,
                createdAt: "2026-10-01T11:00:00Z",
            }),
        ];
        const [post] = groupComments(list);
        expect(post!.threads).toHaveLength(1);
        expect(post!.threads[0]!.root.id).toBe("root");
        expect(post!.threads[0]!.replies.map(r => r.id)).toEqual(["reply-1", "reply-2"]);
        expect(post!.open).toBe(2);
    });

    it("a reply whose parent was not sent stands as its own thread", () => {
        const [post] = groupComments([comment("orphan", { parentId: "gone" })]);
        expect(post!.threads[0]!.root.id).toBe("orphan");
    });

    it("survives a cycle", () => {
        const list = [comment("a", { parentId: "b" }), comment("b", { parentId: "a" })];
        const groups = groupComments(list);
        const ids = groups.flatMap(g =>
            g.threads.flatMap(t => [t.root.id, ...t.replies.map(r => r.id)])
        );
        expect(ids.sort()).toEqual(["a", "b"]);
    });

    it("groups by post, the post with the newest comment first, threads oldest first", () => {
        const list = [
            comment("old-on-1", { createdAt: "2026-10-01T09:00:00Z" }),
            comment("new-on-1", { createdAt: "2026-10-01T15:00:00Z" }),
            comment("on-2", {
                postId: "p-2",
                postExcerpt: "Post two",
                createdAt: "2026-10-03T08:00:00Z",
            }),
        ];
        const groups = groupComments(list);
        expect(groups.map(g => g.postId)).toEqual(["p-2", "p-1"]);
        expect(groups[1]!.threads.map(t => t.root.id)).toEqual(["old-on-1", "new-on-1"]);
        expect(groups[1]!.latestAt).toBe("2026-10-01T15:00:00Z");
        expect(groups[0]!.postExcerpt).toBe("Post two");
    });

    it("counts what is open across a list", () => {
        expect(
            openCount([
                comment("a"),
                comment("b", { isOwn: true }),
                comment("c", { handledAt: "2026-10-02T00:00:00Z" }),
                comment("d"),
            ])
        ).toBe(2);
    });
});
