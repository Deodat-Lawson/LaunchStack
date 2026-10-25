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
import { useFormatter, useTranslations } from "next-intl";
import { useAuth } from "~/lib/auth-client";
import { isBuiltinRole, normalizeRoleSlug, type MembershipStatus } from "~/lib/authz/permissions";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { Card, PageShell } from "~/components/layout/page-shell";
import { Button } from "~/components/ui/button";
import { LANDING_CONTACT_HREF } from "~/config/landing";

interface UserInfo {
    name?: string;
    email?: string;
    company?: string;
    /** The role's slug; `roleName` is the server's (English) name for it. */
    role?: string;
    roleName?: string;
    membershipStatus?: MembershipStatus;
    /** When the account was created, ISO; `submissionDate` is the server's English rendering. */
    createdAt?: string;
    submissionDate?: string;
}

/** Why the membership could not be read: the HTTP status, or nothing for a network failure. */
type LoadError = { status: number | null };

export default function PendingApproval() {
    const t = useTranslations("onboarding.pending");
    const tRoles = useTranslations("auth.roles");
    const tc = useTranslations("common");
    const format = useFormatter();
    const router = useRouter();
    const { userId, signOut } = useAuth();

    const [info, setInfo] = useState<UserInfo | null>(null);
    const [error, setError] = useState<LoadError | null>(null);

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
                    if (!cancelled) setError({ status: response.status });
                    return;
                }
                const data = (await response.json()) as UserInfo;
                if (cancelled) return;
                if (data.membershipStatus === "active") {
                    router.replace("/employer/documents");
                    return;
                }
                setInfo(data);
            } catch {
                if (!cancelled) setError({ status: null });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [userId, router]);

    const suspended = info?.membershipStatus === "suspended";
    const workspace = info?.company ?? t("thisWorkspace");
    const roleSlug = info?.role ? normalizeRoleSlug(info.role) : null;
    const roleName = roleSlug && isBuiltinRole(roleSlug) ? tRoles(roleSlug) : info?.roleName;
    const createdAt = info?.createdAt ? new Date(info.createdAt) : null;
    const submitted =
        createdAt && !Number.isNaN(createdAt.getTime())
            ? format.dateTime(createdAt, { dateStyle: "medium", timeStyle: "short" })
            : info?.submissionDate;

    return (
        <>
            <EmployerChrome
                pageLabel="Launchstack"
                pageTitle={suspended ? t("crumbSuspended") : t("crumbPending")}
            />
            <PageShell>
                <div className="mx-auto max-w-[540px] pt-10">
                    <Card className="p-7 text-center">
                        <div className="bg-brand-soft text-brand mx-auto mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-[18px]">
                            <Clock className="h-7 w-7" />
                        </div>
                        <h1 className="display text-ink m-0 text-[28px] leading-[1.15] tracking-tight">
                            {suspended ? t("titleSuspended") : t("title")}
                        </h1>
                        <p className="text-ink-3 mx-auto mt-2 max-w-[420px] text-sm leading-relaxed">
                            {suspended
                                ? t("bodySuspended", { workspace })
                                : t("body", { workspace })}
                        </p>

                        {error && (
                            <p role="alert" className="text-danger mt-4 text-[13px]">
                                {error.status === null
                                    ? t("loadFailed")
                                    : t("loadFailedStatus", { status: error.status })}
                            </p>
                        )}

                        <div className="border-line bg-panel-2 mt-6 rounded-xl border p-5 text-left">
                            <div className="mono text-ink-3 mb-2.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                                {t("yourRequest")}
                            </div>
                            <div className="grid gap-2.5">
                                <DetailRow
                                    Icon={Building}
                                    label={t("workspace")}
                                    value={info?.company}
                                />
                                <DetailRow
                                    Icon={ShieldCheck}
                                    label={tc("fields.role")}
                                    value={roleName}
                                />
                                <DetailRow
                                    Icon={Mail}
                                    label={tc("fields.email")}
                                    value={info?.email}
                                />
                                <DetailRow Icon={Clock} label={t("submitted")} value={submitted} />
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href="/workspaces">{t("openOther")}</Link>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void signOut({ redirectUrl: "/signin" })}
                            >
                                {tc("actions.signOut")}
                            </Button>
                        </div>

                        <p className="text-ink-3 mt-5 text-xs">
                            {t.rich("stuck", {
                                link: chunks => (
                                    <a
                                        href={LANDING_CONTACT_HREF}
                                        rel="noopener"
                                        className="text-brand font-semibold"
                                    >
                                        {chunks}
                                    </a>
                                ),
                            })}
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
