"use client";

import { useEffect, useState } from "react";

import { WorkspaceSelectClient } from "~/app/workspaces/WorkspaceSelectClient";

/**
 * Local harness for the workspace picker's avatar pile: real teammates, you
 * as each workspace sees you, a guest workspace with no teammates, and a
 * large team that collapses to "+N". Photos are drawn on a canvas so the page
 * needs no backend; `/api/profile` is stubbed for the top-bar chip.
 */

type Props = Parameters<typeof WorkspaceSelectClient>[0];

function face(hue: number, letter: string): string {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const g = canvas.getContext("2d")!;
    g.fillStyle = `oklch(0.6 0.15 ${hue})`;
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = "oklch(0.98 0 0)";
    g.font = "bold 56px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letter, 48, 54);
    return canvas.toDataURL("image/png");
}

export function WorkspacesHarness() {
    const [props, setProps] = useState<Props | null>(null);

    useEffect(() => {
        const me = face(260, "A");
        const original = window.fetch.bind(window);
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.startsWith("/api/profile")) {
                const profile = {
                    name: "Ada Lovelace",
                    email: "ada@launchstack.test",
                    displayName: "Ada",
                    title: null,
                    pronouns: null,
                    timeZone: null,
                    bio: null,
                    avatarUrl: me,
                };
                return new Response(
                    JSON.stringify({
                        profile,
                        workspace: null,
                        effective: { ...profile, displayName: "Ada", initials: "A" },
                    }),
                    { headers: { "Content-Type": "application/json" } }
                );
            }
            return original(input, init);
        }) as typeof window.fetch;

        const base = {
            description: null,
            status: "active",
            lastOpenedAt: new Date(Date.now() - 3_600_000).toISOString(),
            isActive: false,
        };
        setProps({
            account: { name: "Ada Lovelace", email: "ada@launchstack.test" },
            fromSignup: false,
            workspaces: [
                {
                    ...base,
                    id: "1",
                    name: "Acme Robotics",
                    slug: "acme",
                    swatch: 1,
                    role: "owner",
                    memberCount: 9,
                    isActive: true,
                    me: { name: "Ada", avatarUrl: me },
                    teammates: [
                        { name: "Bob Okafor", avatarUrl: face(150, "B") },
                        { name: "Cai Rivera", avatarUrl: null },
                        { name: "Dee Park", avatarUrl: face(30, "D") },
                    ],
                },
                {
                    ...base,
                    id: "2",
                    name: "Client: Beta Co",
                    slug: "beta",
                    swatch: 3,
                    role: "guest",
                    memberCount: 14,
                    // Their own photo for this client, and no teammates: a guest can't list members.
                    me: { name: "Ada (Acme advisor)", avatarUrl: face(200, "β") },
                    teammates: [],
                },
                {
                    ...base,
                    id: "3",
                    name: "Side project",
                    slug: "side",
                    swatch: 5,
                    role: "member",
                    memberCount: 2,
                    me: null,
                    teammates: [{ name: "Eve Zhou", avatarUrl: null }],
                },
            ],
        });
        return () => {
            window.fetch = original;
        };
    }, []);

    return props ? <WorkspaceSelectClient {...props} /> : null;
}
