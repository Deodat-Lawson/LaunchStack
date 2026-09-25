"use client";

import { useEffect, useState } from "react";

import { PresenceAvatars } from "~/app/employer/documents/_mindmap/ui/PresenceLayer";
import { AccountMenu } from "~/app/employer/documents/_workspace/AccountMenu";
import { AuditTab } from "~/app/employer/documents/_workspace/settings/people/AuditTab";
import type { SettingsSectionActions } from "~/app/employer/documents/_workspace/settings/contract";
import { MembersTab } from "~/app/employer/documents/_workspace/settings/people/MembersTab";
import type { Member } from "~/app/employer/documents/_workspace/settings/people/api";
import { ProfileEditor } from "~/app/employer/documents/_workspace/settings/ProfileEditor";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { ProfilePatchSchema, WorkspaceProfilePatchSchema } from "~/lib/profile/fields";
import {
    resolveProfile,
    type MyProfile,
    type ProfileFields,
    type WorkspaceProfileOverride,
} from "~/lib/profile/resolve";
import { useMyProfile } from "~/lib/profile/use-my-profile";

/**
 * Local harness for profiles. Mounts the real Account → Profile editor, the
 * real sidebar AccountMenu, Members table, Mindmap presence stack and audit
 * log, with `/api/profile*`, `/api/workspace/members` and
 * `/api/workspace/audit` answered from memory — the same zod schemas
 * and the same `resolveProfile` the server uses, so validation and
 * per-workspace resolution behave as they do for real. The photo route keeps
 * the uploaded (browser-cropped) PNG as a blob URL and reports its size in
 * the debug strip, which is how the crop output is checked.
 *
 * `?workspace=0` simulates a person with no active workspace (signup).
 */

interface Sim {
    profile: Omit<ProfileFields, "avatarUrl">;
    photo: string | null;
    workspaceName: string | null;
    override: WorkspaceProfileOverride;
    lastUpload: string | null;
}

let sim: Sim = {
    profile: {
        name: "Ada Lovelace",
        email: "ada@launchstack.test",
        displayName: null,
        title: "Founder",
        pronouns: null,
        timeZone: null,
        bio: null,
    },
    photo: null,
    workspaceName: "Acme Robotics",
    override: { displayName: null, title: null, avatarUrl: null },
    lastUpload: null,
};

function snapshot(): MyProfile {
    const profile: ProfileFields = { ...sim.profile, avatarUrl: sim.photo };
    const workspace = sim.workspaceName
        ? { id: "1", name: sim.workspaceName, override: sim.override }
        : null;
    return { profile, workspace, effective: resolveProfile(profile, workspace?.override) };
}

function teammates(): Member[] {
    const me = snapshot().effective;
    const base = {
        authUserId: "x",
        roleName: "Member",
        role: "member",
        status: "active" as const,
        groups: [],
        joinedAt: "2026-09-01T00:00:00Z",
        lastActiveAt: null,
        isSelf: false,
        avatarUrl: null,
        pronouns: null,
    };
    return [
        {
            ...base,
            id: 1,
            name: me.name,
            email: me.email,
            displayName: me.displayName,
            title: me.title,
            pronouns: me.pronouns,
            avatarUrl: me.avatarUrl,
            role: "owner",
            roleName: "Owner",
            isSelf: true,
        },
        {
            ...base,
            id: 2,
            name: "Bob Okafor",
            email: "bob@launchstack.test",
            displayName: "Bob",
            title: "Engineer",
            pronouns: "he/him",
        },
        {
            ...base,
            id: 3,
            name: "Cai Rivera",
            email: "cai@launchstack.test",
            displayName: "Cai Rivera",
            title: null,
        },
    ];
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

async function describeUpload(blob: Blob): Promise<string> {
    const bitmap = await createImageBitmap(blob);
    const text = `${blob.type} ${bitmap.width}×${bitmap.height}, ${Math.round(blob.size / 1024)} KB`;
    bitmap.close();
    return text;
}

function installFetchStub(onChange: () => void): () => void {
    const original = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            window.location.origin
        );
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;

        if (url.pathname === "/api/profile") {
            if (method === "PATCH") {
                const parsed = ProfilePatchSchema.safeParse(body);
                if (!parsed.success) return json({ error: parsed.error.errors[0]?.message }, 400);
                sim = { ...sim, profile: { ...sim.profile, ...parsed.data } };
                onChange();
            }
            return json(snapshot());
        }
        if (url.pathname === "/api/profile/workspace") {
            if (!sim.workspaceName) return json({ error: "Open a workspace first." }, 404);
            if (method === "DELETE") {
                sim = { ...sim, override: { displayName: null, title: null, avatarUrl: null } };
            } else {
                const parsed = WorkspaceProfilePatchSchema.safeParse(body);
                if (!parsed.success) return json({ error: parsed.error.errors[0]?.message }, 400);
                sim = { ...sim, override: { ...sim.override, ...parsed.data } };
            }
            onChange();
            return json(snapshot());
        }
        if (url.pathname === "/api/profile/photo") {
            const scope = url.searchParams.get("scope") ?? "global";
            let next: string | null = null;
            if (method === "PUT") {
                const file = (init?.body as FormData).get("file");
                if (!(file instanceof Blob)) return json({ error: "Attach the photo." }, 400);
                next = URL.createObjectURL(file);
                sim = { ...sim, lastUpload: await describeUpload(file) };
            }
            sim =
                scope === "workspace"
                    ? { ...sim, override: { ...sim.override, avatarUrl: next } }
                    : { ...sim, photo: next };
            onChange();
            return json(snapshot());
        }
        if (url.pathname === "/api/workspace/members") {
            return json({ members: teammates(), counts: { active: 3, pending: 0, suspended: 0 } });
        }
        if (url.pathname === "/api/workspace/roles") return json({ error: "stub" }, 503);
        if (url.pathname === "/api/workspace/audit") {
            const me = snapshot().effective;
            return json({
                events: [
                    {
                        id: 2,
                        action: "member.role_changed",
                        actor: {
                            authUserId: "ada",
                            name: me.name,
                            email: me.email,
                            avatarUrl: me.avatarUrl,
                        },
                        targetType: "member",
                        targetId: "2",
                        detail: { targetName: "Bob Okafor", fromRole: "member", toRole: "admin" },
                        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
                    },
                    {
                        id: 1,
                        action: "member.joined",
                        actor: {
                            authUserId: "cai",
                            name: "Cai Rivera",
                            email: "cai@launchstack.test",
                            avatarUrl: null,
                        },
                        targetType: "member",
                        targetId: "3",
                        detail: null,
                        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
                    },
                ],
                nextCursor: null,
            });
        }
        return original(input, init);
    }) as typeof window.fetch;
    return () => {
        window.fetch = original;
    };
}

export function ProfileHarness() {
    const [ready, setReady] = useState(false);
    const [actions, setActions] = useState<SettingsSectionActions | null>(null);
    const [version, setVersion] = useState(0);
    const { data } = useMyProfile({ enabled: ready });

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("workspace") === "0") {
            sim = { ...sim, workspaceName: null };
        }
        const restore = installFetchStub(() => setVersion(v => v + 1));
        setReady(true);
        return restore;
    }, []);

    if (!ready) return null;
    const me = data?.effective;

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <Toaster richColors position="top-right" />
            <header className="border-line flex items-center justify-between border-b px-6 py-3">
                <div className="text-sm font-semibold">Profile harness</div>
                <AccountMenu
                    variant="avatar"
                    userName={me?.displayName}
                    userEmail={me?.email}
                    userTitle={me?.title}
                    avatarUrl={me?.avatarUrl}
                    onOpenSettings={() => undefined}
                    onSignOut={() => undefined}
                />
            </header>

            <main className="mx-auto max-w-5xl px-6 py-8">
                <div className="border-line bg-panel sticky top-0 z-10 mb-6 flex items-center justify-between rounded-lg border px-4 py-2">
                    <span className="text-ink-3 text-xs" data-testid="last-upload">
                        Last upload: {sim.lastUpload ?? "none"}
                    </span>
                    <Button
                        size="sm"
                        disabled={
                            !actions?.onPrimary ||
                            Boolean(actions.disabled) ||
                            Boolean(actions.busy)
                        }
                        onClick={() => void actions?.onPrimary?.()}
                    >
                        {actions?.busy ? actions.primaryBusyLabel : actions?.primaryLabel}
                    </Button>
                </div>
                <ProfileEditor onActions={setActions} emailVerified />
                <h2 className="mb-3 mt-10 text-base font-bold">Members</h2>
                <MembersTab key={version} can={() => false} />
                <h2 className="mb-3 mt-10 text-base font-bold">Mindmap presence</h2>
                <div className="border-line bg-panel flex items-center gap-3 rounded-lg border px-4 py-3">
                    <PresenceAvatars
                        peers={[
                            {
                                userId: "ada",
                                displayName: me?.displayName ?? null,
                                avatarUrl: me?.avatarUrl ?? null,
                                pageId: null,
                                cursor: null,
                                selection: [],
                                revisionSeen: 0,
                                lastSeenAt: new Date().toISOString(),
                            },
                            {
                                userId: "cai",
                                displayName: "Cai Rivera",
                                avatarUrl: null,
                                pageId: null,
                                cursor: null,
                                selection: [],
                                revisionSeen: 0,
                                lastSeenAt: new Date().toISOString(),
                            },
                        ]}
                    />
                    <span className="text-ink-3 text-xs">Ring: each person’s cursor colour</span>
                </div>
                <h2 className="mb-3 mt-10 text-base font-bold">Audit log</h2>
                <AuditTab key={`audit-${version}`} can={() => true} />
            </main>
        </div>
    );
}
