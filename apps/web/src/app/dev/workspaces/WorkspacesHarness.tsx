"use client";

import { useEffect, useState } from "react";

import { WorkspaceSelectClient } from "~/app/workspaces/WorkspaceSelectClient";
import { authClient } from "~/lib/auth-client";

/**
 * Local harness for the workspace picker, no sign-in needed: the avatar pile
 * (real teammates, you as each workspace sees you, a guest workspace with no
 * teammates, a large team that collapses to "+N"), a membership waiting for
 * approval, one pending invite, and the account menu with two accounts
 * signed in on this browser. Photos are drawn on a canvas.
 *
 * Stubbed: `/api/profile` (the chip's photo), Better Auth's `get-session`
 * and `multi-session/list-device-sessions` (the menu). Anything that would
 * change something — switching account or workspace, signing out, accepting
 * or declining — answers with an error, so the page shows its in-place error
 * states instead of navigating away from the preview.
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
        const grace = face(150, "G");
        const original = window.fetch.bind(window);
        const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            });
        const now = new Date();
        const later = new Date(Date.now() + 7 * 86_400_000);
        const deviceSession = (token: string, user: Record<string, unknown>) => ({
            session: {
                id: `s-${token}`,
                token,
                userId: user.id,
                expiresAt: later.toISOString(),
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            },
            user: {
                emailVerified: true,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                ...user,
            },
        });
        const ada = deviceSession("tok-ada", {
            id: "user-ada",
            name: "Ada Lovelace",
            email: "ada@launchstack.test",
            image: null,
        });
        const graceSession = deviceSession("tok-grace", {
            id: "user-grace",
            name: "Grace Hopper",
            email: "grace@northwind.test",
            // The menu shows the profile photo (device-photos), not this.
            image: null,
        });
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const raw =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            // Better Auth calls with absolute URLs; the app with paths.
            const url = raw.startsWith("http") ? new URL(raw).pathname : raw;
            if (url.startsWith("/api/auth/get-session")) return json(ada);
            if (url.startsWith("/api/auth/multi-session/list-device-sessions")) {
                return json([ada, graceSession]);
            }
            if (url.startsWith("/api/profile/device-photos")) {
                return json({ photos: { "user-ada": me, "user-grace": grace } });
            }
            if (url.startsWith("/api/auth/device-sessions/remember")) {
                return json({ remembered: true });
            }
            if (
                url.startsWith("/api/auth/multi-session/") ||
                url.startsWith("/api/auth/sign-out") ||
                url.startsWith("/api/workspace/invitations/") ||
                /^\/api\/workspaces\/[^/]+\/switch/.test(url)
            ) {
                return json({ error: "This is a preview: nothing changes here." }, 503);
            }
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
            pendingInvites: [
                {
                    id: "71",
                    companyName: "Northwind Labs",
                    slug: "northwind",
                    swatch: 2,
                    invitedBy: "Grace Hopper",
                    invitedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
                    role: "member",
                },
            ],
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
                {
                    ...base,
                    id: "4",
                    name: "Waiting Room Inc",
                    slug: "waiting",
                    swatch: 6,
                    role: "member",
                    // Asked to join by link; no admin has approved it yet.
                    status: "pending",
                    memberCount: 5,
                    me: null,
                    teammates: [],
                },
            ],
        });
        return () => {
            window.fetch = original;
        };
    }, []);

    // The session was read before the stub was in place; read it again once
    // the account menu is mounted and listening, so it sees the stubbed one.
    useEffect(() => {
        if (props) authClient.$store.notify("$sessionSignal");
    }, [props]);

    return props ? <WorkspaceSelectClient {...props} /> : null;
}
