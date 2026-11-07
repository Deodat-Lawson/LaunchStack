/**
 * The Accounts screen's network list for a workspace that does not own the
 * deployment's X and Reddit keys: both read as unavailable, and the reason
 * (in the catalogue's words, so it follows the interface language) says
 * the operator's account is assigned to another workspace.
 */
jest.mock("~/env", () => ({ env: { server: { EMBEDDING_SECRETS_KEY: "k" }, client: {} } }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("@launchstack/tools/social-publish", () => ({
    describePublishConfig: () => ({
        x: { configured: true, identity: null },
        linkedin: { configured: false, identity: null },
        bluesky: { configured: false, identity: null },
        reddit: { configured: true, identity: null },
    }),
}));

import { listBrandNetworks } from "~/server/brand/accounts";

const byPlatform = (owns: boolean) =>
    Object.fromEntries(listBrandNetworks(owns).map(n => [n.platform, n]));

it("offers the deployment's X and Reddit to the workspace that owns them", () => {
    const n = byPlatform(true);
    expect(n.x!.available).toBe(true);
    expect(n.reddit!.available).toBe(true);
    expect(n.x!.setupCopy).toEqual([]);
});

it("tells any other workspace they belong to another one", () => {
    const n = byPlatform(false);
    for (const network of [n.x!, n.reddit!]) {
        expect(network.available).toBe(false);
        expect(network.setupCopy).toEqual([
            expect.objectContaining({ key: "growth.server.brand.networks.shared.notYours" }),
        ]);
        expect(network.setup[0]).toMatch(/assigned to another one/);
    }
});
