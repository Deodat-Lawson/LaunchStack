/**
 * Which addresses a workspace may point its own model at.
 *
 * The server posts prompts — and the workspace's key — to whatever address is
 * saved here, so on the hosted service it gets the same treatment as any other
 * user-supplied URL the server fetches: https only, and a host that resolves to
 * the public internet (`~/server/security/url-guard`). Otherwise a workspace
 * admin could aim the server at its own metadata service or database.
 *
 * A self-hosted deployment is one organisation's own machine, and the common
 * reason to bring a model there is a server on the same network (vLLM, LM
 * Studio, a GPU box down the hall). Private addresses and plain http are
 * allowed there.
 */

import { isCloudDeployment } from "~/server/deployment";
import { UrlGuardError, assertPublicHttpUrl } from "~/server/security/url-guard";

/** A problem with the address, worded for the admin who typed it. */
export class WorkspaceEndpointUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkspaceEndpointUrlError";
    }
}

/** Whether this deployment accepts private, loopback and plain-http addresses. */
export function allowsPrivateModelEndpoints(): boolean {
    return !isCloudDeployment();
}

/**
 * Parse and tidy an address without touching the network: http(s) only, no
 * credentials or query string in it, no trailing slash. The result is what
 * gets stored and compared.
 */
export function normalizeEndpointUrl(raw: string): string {
    const text = raw.trim();
    if (!text) throw new WorkspaceEndpointUrlError("Enter the address of your model endpoint.");
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw new WorkspaceEndpointUrlError(
            "That isn't a web address. It should look like https://api.example.com/v1."
        );
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new WorkspaceEndpointUrlError("The address has to start with https://.");
    }
    if (url.protocol === "http:" && !allowsPrivateModelEndpoints()) {
        throw new WorkspaceEndpointUrlError("The address has to start with https://.");
    }
    if (url.username || url.password) {
        throw new WorkspaceEndpointUrlError(
            "Put the key in the API key field, not in the address."
        );
    }
    if (url.search || url.hash) {
        throw new WorkspaceEndpointUrlError(
            "Leave the query string off the address; the base URL ends at the path, like /v1."
        );
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
}

/**
 * Normalize, then — on the hosted service — check that the host resolves to
 * public addresses. Run when an address is saved or tested, and again each
 * time a workspace's configuration is loaded, so a DNS change after saving is
 * caught too.
 */
export async function assertEndpointUrlAllowed(raw: string): Promise<string> {
    const normalized = normalizeEndpointUrl(raw);
    if (allowsPrivateModelEndpoints()) return normalized;
    try {
        await assertPublicHttpUrl(normalized);
    } catch (error) {
        if (error instanceof UrlGuardError) {
            throw new WorkspaceEndpointUrlError(
                "That address points inside a private network, which this server doesn't allow. Use your provider's public address."
            );
        }
        throw error;
    }
    return normalized;
}
