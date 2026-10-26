"use client";
import { PersonalContextPanel, type PersonalContextClientV0 } from "./PersonalContextPanel";
import type { PersonalContextViewV0 } from "~/lib/vantage/personal-context";

async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const response = await fetch(`/api/vantage/context-v0/${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("Personal context request failed.");
    return response.json();
}
export const personalContextHttpClient: PersonalContextClientV0 = {
    async load() {
        return (await request("personal")) as PersonalContextViewV0;
    },
    async saveRoles(change) {
        await request("roles", "PATCH", change);
    },
    async setStar({ documentId, ...change }) {
        await request(`stars/${encodeURIComponent(documentId)}`, "PUT", change);
    },
};

export function PersonalContextScreen() {
    return <PersonalContextPanel client={personalContextHttpClient} />;
}
