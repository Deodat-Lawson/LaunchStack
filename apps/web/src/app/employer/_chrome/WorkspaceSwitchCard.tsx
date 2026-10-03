"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";

import { cn } from "~/lib/utils";

import { useEmployerWorkspaceSwitcher } from "./EmployerWorkspaceSwitcherContext";
import pill from "./WorkspaceSwitcherPill.module.css";

/**
 * Which workspace these settings belong to, and the way to a different one.
 *
 * Switching lives here rather than behind a back arrow. A workspace is a whole
 * separate environment — its own people, documents and settings — so leaving
 * one is not "going back" from the Studio. Settings is where a person already
 * goes to deal with the workspace as a whole, which makes it the one place
 * this belongs (the avatar menu keeps its quick row as well).
 */
export function WorkspaceSwitchCard({ className }: { className?: string }) {
    const workspace = useEmployerWorkspaceSwitcher();
    if (!workspace) return null;
    const swatch = pill[`gradient${workspace.swatch ?? 1}`] ?? pill.gradient1;
    const others = Math.max(0, workspace.membershipCount - 1);

    return (
        <Link
            href="/workspaces"
            data-testid="settings-switch-workspace"
            title="Switch to another workspace"
            className={cn(
                "border-line bg-surface hover:bg-line-2 focus-visible:ring-brand/50 group flex items-center gap-2.5 rounded-lg border px-2.5 py-2 outline-none transition-colors focus-visible:ring-[3px]",
                className
            )}
        >
            <span className={cn(pill.mark, swatch, "shrink-0")}>{workspace.initials}</span>
            <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[12.5px] font-semibold">
                    {workspace.name}
                </span>
                <span className="text-ink-3 block truncate text-[11px]">
                    {others > 0
                        ? `Switch workspace · ${others} other${others === 1 ? "" : "s"}`
                        : "Switch workspace"}
                </span>
            </span>
            <ArrowLeftRight
                aria-hidden
                className="text-ink-3 group-hover:text-ink size-3.5 shrink-0"
            />
        </Link>
    );
}
