"use client";

/**
 * The holding page for someone whose membership is not yet active: awaiting
 * approval, or suspended. Reads `/api/fetchUserInfo`, which reports the
 * membership status alongside the workspace and role names, and moves on the
 * moment the membership turns active.
 */

import React, { useEffect, useState } from "react";
import { Building, Clock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "~/lib/auth-client";
import type { MembershipStatus } from "~/lib/authz/permissions";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { Card, PageShell } from "~/components/layout/page-shell";
import { Button } from "~/components/ui/button";
import { LANDING_CONTACT_URL } from "~/config/landing";

interface UserInfo {
    name?: string;
    email?: string;
    company?: string;
    roleName?: string;
    membershipStatus?: MembershipStatus;
    submissionDate?: string;
}

export default function PendingApproval() {
    const router = useRouter();
    const { userId, signOut } = useAuth();

    const [info, setInfo] = useState<UserInfo | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch("/api/fetchUserInfo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                if (!response.ok) {
                    // No membership anywhere: the picker is where they can create one.
                    if (response.status === 403) {
                        router.replace("/workspaces");
                        return;
                    }
                    throw new Error(`Could not load your membership (${response.status}).`);
                }
                const data = (await response.json()) as UserInfo;
                if (cancelled) return;
                if (data.membershipStatus === "active") {
                    router.replace("/employer/documents");
                    return;
                }
                setInfo(data);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error ? err.message : "Could not load your membership."
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [userId, router]);

    const suspended = info?.membershipStatus === "suspended";
    const workspace = info?.company ?? "this workspace";

    return (
        <>
            <EmployerChrome
                pageLabel="Launchstack"
                pageTitle={suspended ? "Access suspended" : "Pending approval"}
            />
            <PageShell>
                <div className="mx-auto max-w-[540px] pt-10">
                    <Card className="p-7 text-center">
                        <div className="bg-brand-soft text-brand mx-auto mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-[18px]">
                            <Clock className="h-7 w-7" />
                        </div>
                        <h1 className="serif text-ink m-0 text-[28px] leading-[1.15] tracking-tight">
                            {suspended ? "Your access is suspended" : "Waiting for approval"}
                        </h1>
                        <p className="text-ink-3 mx-auto mt-2 max-w-[420px] text-sm leading-relaxed">
                            {suspended
                                ? `An admin of ${workspace} has paused your access. You stay a member, but nothing opens until they reinstate you.`
                                : `An admin of ${workspace} has to confirm you before anything opens. You'll get an email as soon as they do.`}
                        </p>

                        {error && (
                            <p role="alert" className="text-danger mt-4 text-[13px]">
                                {error}
                            </p>
                        )}

                        <div className="border-line bg-panel-2 mt-6 rounded-xl border p-5 text-left">
                            <div className="mono text-ink-3 mb-2.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                                Your request
                            </div>
                            <div className="grid gap-2.5">
                                <DetailRow
                                    Icon={Building}
                                    label="Workspace"
                                    value={info?.company}
                                />
                                <DetailRow Icon={ShieldCheck} label="Role" value={info?.roleName} />
                                <DetailRow Icon={Mail} label="Email" value={info?.email} />
                                <DetailRow
                                    Icon={Clock}
                                    label="Submitted"
                                    value={info?.submissionDate}
                                />
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href="/workspaces">Open a different workspace</Link>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void signOut({ redirectUrl: "/signin" })}
                            >
                                Sign out
                            </Button>
                        </div>

                        <p className="text-ink-3 mt-5 text-xs">
                            Stuck? Ask the person who invited you, or{" "}
                            <a
                                href={LANDING_CONTACT_URL}
                                rel="noopener"
                                className="text-brand font-semibold"
                            >
                                contact support
                            </a>
                            .
                        </p>
                    </Card>
                </div>
            </PageShell>
        </>
    );
}

function DetailRow({
    Icon,
    label,
    value,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string | undefined;
}) {
    return (
        <div className="flex items-center gap-2.5">
            <Icon className="text-ink-3 h-[15px] w-[15px] shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="mono text-ink-3 text-[10px] font-semibold uppercase tracking-[0.08em]">
                    {label}
                </div>
                <div className="text-ink truncate text-[13px]">{value ?? "—"}</div>
            </div>
        </div>
    );
}
