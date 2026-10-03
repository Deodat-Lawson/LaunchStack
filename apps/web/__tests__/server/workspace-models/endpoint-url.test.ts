/**
 * The hosted service only lets a workspace aim its model at a public https
 * address; a self-hosted deployment may use its own network.
 */

const mockIsCloud = jest.fn(() => false);
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => mockIsCloud() }));

import {
    WorkspaceEndpointUrlError,
    assertEndpointUrlAllowed,
    normalizeEndpointUrl,
} from "~/server/workspace-models/endpoint-url";

describe("workspace endpoint address policy", () => {
    beforeEach(() => mockIsCloud.mockReturnValue(false));

    it("tidies an address to scheme, host and path", () => {
        expect(normalizeEndpointUrl("  https://API.example.com/v1/ ")).toBe(
            "https://api.example.com/v1"
        );
        expect(normalizeEndpointUrl("https://openrouter.ai/api/v1")).toBe(
            "https://openrouter.ai/api/v1"
        );
    });

    it.each([
        ["", /Enter the address/],
        ["api.example.com/v1", /isn't a web address/],
        ["ftp://example.com", /https:\/\//],
        ["https://user:sk-secret@example.com/v1", /API key field/],
        ["https://example.com/v1?key=abc", /query string/],
    ])("refuses %p", (raw, message) => {
        expect(() => normalizeEndpointUrl(raw)).toThrow(WorkspaceEndpointUrlError);
        expect(() => normalizeEndpointUrl(raw)).toThrow(message);
    });

    it("self-hosted: allows plain http and the local network", async () => {
        await expect(assertEndpointUrlAllowed("http://localhost:11434/v1")).resolves.toBe(
            "http://localhost:11434/v1"
        );
        await expect(assertEndpointUrlAllowed("http://10.0.0.5:8000/v1")).resolves.toBe(
            "http://10.0.0.5:8000/v1"
        );
    });

    it("hosted: refuses plain http", async () => {
        mockIsCloud.mockReturnValue(true);
        await expect(assertEndpointUrlAllowed("http://api.example.com/v1")).rejects.toThrow(
            /https:\/\//
        );
    });

    it.each([
        "https://127.0.0.1/v1",
        "https://10.1.2.3/v1",
        "https://169.254.169.254/latest",
        "https://[::1]/v1",
    ])("hosted: refuses the private address %s", async raw => {
        mockIsCloud.mockReturnValue(true);
        await expect(assertEndpointUrlAllowed(raw)).rejects.toThrow(/private network/);
    });

    it("hosted: accepts a public literal address", async () => {
        mockIsCloud.mockReturnValue(true);
        await expect(assertEndpointUrlAllowed("https://8.8.8.8/v1")).resolves.toBe(
            "https://8.8.8.8/v1"
        );
    });
});
