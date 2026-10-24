/**
 * Growth › Brand: the rules about channels the screens rely on — what
 * Compose starts with, how a channel is named, and how a sign-in's life is
 * said. Pure functions over the client contract's types.
 */

import {
    byKindThenName,
    capabilityWords,
    composeChannels,
    defaultChannelSelection,
    groupByNetwork,
    initials,
    isPostable,
    tokenExpiry,
    unavailableReason,
} from "~/app/employer/tools/growth/brand/_lib/channels";
import type { BrandChannel } from "~/app/employer/tools/growth/brand/api";
import { englishMessages } from "~/i18n/messages";
import { createTranslator } from "use-intl";

const t = createTranslator({
    locale: "en",
    messages: englishMessages,
    namespace: "growth.brand.channels",
});

function channel(id: string, patch: Partial<BrandChannel> = {}): BrandChannel {
    return {
        id,
        platform: "linkedin",
        kind: "organization",
        name: id,
        handle: null,
        avatarUrl: null,
        profileUrl: null,
        enabled: true,
        status: "active",
        statusReason: null,
        connectionId: 1,
        capabilities: { publish: true, images: true, analytics: true, comments: true },
        followers: null,
        limit: 3000,
        ...patch,
    };
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

describe("initials", () => {
    it.each([
        ["Dana Okafor", "DO"],
        ["LaunchStack", "L"],
        ["LaunchStack Labs", "LL"],
        ["launchstack.bsky.social", "L"],
        ["@sam.bsky.social", "S"],
        ["Jean-Luc   Picard  Smith", "JS"],
        ["", "?"],
    ])("%s → %s", (name, expected) => {
        expect(initials(name)).toBe(expected);
    });
});

describe("capabilityWords", () => {
    it("lists what a channel can do, publishing assumed", () => {
        expect(
            capabilityWords(t, { publish: true, images: true, analytics: true, comments: true })
        ).toEqual(["Images", "Analytics", "Comments"]);
        expect(
            capabilityWords(t, { publish: true, images: true, analytics: false, comments: false })
        ).toEqual(["Images"]);
    });

    it("says so when a channel cannot publish", () => {
        expect(
            capabilityWords(t, { publish: false, images: false, analytics: true, comments: false })
        ).toEqual(["Cannot publish", "Analytics"]);
    });
});

describe("groupByNetwork", () => {
    it("groups in the product's network order and leaves empty networks out", () => {
        const items = [
            channel("bsky", { platform: "bluesky", kind: "account" }),
            channel("dana", { kind: "person", name: "Dana Okafor" }),
            channel("labs", { name: "LaunchStack Labs" }),
            channel("ls", { name: "LaunchStack" }),
        ];
        const groups = groupByNetwork(items, byKindThenName);
        expect(groups.map(g => g.platform)).toEqual(["linkedin", "bluesky"]);
        // Pages first, then people; by name inside a kind.
        expect(groups[0]!.items.map(c => c.name)).toEqual([
            "LaunchStack",
            "LaunchStack Labs",
            "Dana Okafor",
        ]);
    });

    it("keeps the order it was given without a comparator", () => {
        const items = [channel("b"), channel("a")];
        expect(groupByNetwork(items)[0]!.items.map(c => c.id)).toEqual(["b", "a"]);
    });
});

describe("Compose's channels", () => {
    const page = channel("page");
    const offPage = channel("off", { enabled: false });
    const brokenPage = channel("broken", {
        status: "reconnect",
        statusReason: "LinkedIn revoked the token.",
    });
    const person = channel("dana", { kind: "person" });
    const bsky = channel("bsky", { platform: "bluesky", kind: "account", limit: 300 });

    it("hides channels an admin switched off, keeps ones that need reconnecting", () => {
        expect(composeChannels([page, offPage, brokenPage]).map(c => c.id)).toEqual([
            "page",
            "broken",
        ]);
    });

    it("only active, enabled, publishing channels are postable", () => {
        expect(isPostable(page)).toBe(true);
        expect(isPostable(offPage)).toBe(false);
        expect(isPostable(brokenPage)).toBe(false);
        expect(
            isPostable(channel("ro", { capabilities: { ...page.capabilities, publish: false } }))
        ).toBe(false);
    });

    it("starts with the company's active Pages when there are any", () => {
        expect(defaultChannelSelection([person, page, offPage, brokenPage, bsky])).toEqual([
            "page",
        ]);
    });

    it("falls back to every postable channel when there is no Page", () => {
        expect(defaultChannelSelection([person, brokenPage, bsky, offPage])).toEqual([
            "dana",
            "bsky",
        ]);
    });

    it("a campaign hand-off picks that network's postable channels", () => {
        expect(defaultChannelSelection([person, page, bsky, brokenPage], "linkedin")).toEqual([
            "dana",
            "page",
        ]);
        expect(defaultChannelSelection([person, page, bsky], "bluesky")).toEqual(["bsky"]);
        expect(defaultChannelSelection([person, page], "x")).toEqual([]);
    });

    it("says why a channel cannot be picked", () => {
        expect(unavailableReason(t, page)).toBeNull();
        expect(unavailableReason(t, brokenPage)).toBe("LinkedIn revoked the token.");
        expect(unavailableReason(t, channel("x", { status: "reconnect" }))).toMatch(/reconnect/i);
    });
});

describe("tokenExpiry", () => {
    it("a refreshable sign-in renews itself whatever its expiry", () => {
        expect(tokenExpiry(t, { refreshable: true, expiresAt: inDays(3) }, NOW)).toEqual({
            word: "Renews itself",
            tone: "ok",
        });
    });

    it("a token without an expiry does not expire", () => {
        expect(tokenExpiry(t, { refreshable: false, expiresAt: null }, NOW)).toEqual({
            word: "Does not expire",
            tone: "ok",
        });
    });

    it.each([
        [23, "Expires in 23 days", "ok"],
        [14, "Expires in 14 days", "ok"],
        [13, "Expires in 13 days", "warn"],
        [1, "Expires in 1 day", "warn"],
    ])("%s days left → %s (%s)", (days, word, tone) => {
        expect(tokenExpiry(t, { refreshable: false, expiresAt: inDays(days) }, NOW)).toEqual({
            word,
            tone,
        });
    });

    it("under a day, counts hours", () => {
        expect(
            tokenExpiry(
                t,
                { refreshable: false, expiresAt: new Date(NOW + 5 * 3_600_000).toISOString() },
                NOW
            )
        ).toEqual({ word: "Expires in 5 hours", tone: "warn" });
    });

    it("an expired token is danger", () => {
        expect(tokenExpiry(t, { refreshable: false, expiresAt: inDays(-0.2) }, NOW)).toEqual({
            word: "Expired today",
            tone: "danger",
        });
        expect(tokenExpiry(t, { refreshable: false, expiresAt: inDays(-3) }, NOW)).toEqual({
            word: "Expired 3 days ago",
            tone: "danger",
        });
    });
});
