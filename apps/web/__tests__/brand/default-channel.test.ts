/**
 * Where the campaign generator's Publish goes when it names no channel: the
 * workspace's own Page (the one with the most followers), never a switched
 * off or broken channel, and the deployment's account only as a last resort.
 */
jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/brand/channels", () => ({}));
jest.mock("~/server/services/connectors/config", () => ({}));
jest.mock("@launchstack/pipelines/marketing/posts", () => ({ platformLimit: () => 3000 }));
jest.mock("@launchstack/tools/social-publish", () => ({}));

import type { BrandChannelView } from "~/server/brand/channels";
import { pickDefaultChannel } from "~/server/brand/accounts";

const base: BrandChannelView = {
    id: "",
    platform: "linkedin",
    kind: "organization",
    name: "",
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
};
const ch = (over: Partial<BrandChannelView>): BrandChannelView => ({ ...base, ...over });

it("prefers the Page with the most followers over one that sorts first by name", () => {
    const picked = pickDefaultChannel(
        [
            ch({ id: "careers", name: "Acme Careers", followers: 120 }),
            ch({ id: "main", name: "Acme", followers: 9000 }),
            ch({ id: "me", name: "Dana", kind: "person" }),
        ],
        "linkedin"
    );
    expect(picked?.id).toBe("main");
});

it("a Page before a person, and skips switched-off, broken or post-less channels", () => {
    expect(
        pickDefaultChannel(
            [
                ch({ id: "off", name: "A", enabled: false }),
                ch({ id: "broken", name: "B", status: "reconnect" }),
                ch({
                    id: "noperm",
                    name: "C",
                    capabilities: { ...base.capabilities, publish: false },
                }),
                ch({ id: "me", name: "Dana", kind: "person" }),
            ],
            "linkedin"
        )?.id
    ).toBe("me");
});

it("uses the deployment account only when the workspace has nothing of its own", () => {
    const deployment = ch({
        id: "deployment:x",
        platform: "x",
        kind: "deployment",
        connectionId: null,
    });
    expect(pickDefaultChannel([deployment], "x")?.id).toBe("deployment:x");
    expect(pickDefaultChannel([deployment], "linkedin")).toBeNull();
});
