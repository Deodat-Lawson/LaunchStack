"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import {
    ArrowLeftRight,
    BookOpen,
    ChevronsUpDown,
    LogOut,
    Moon,
    Settings,
    Sun,
} from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { writeSettingValue } from "~/lib/settings/useSettings";

import { useEmployerWorkspaceSwitcher } from "../../_chrome/EmployerWorkspaceSwitcherContext";

const DOCS_URL = "https://github.com/Deodat-Lawson/LaunchStack#readme";

export interface AccountMenuProps {
    userInitials: string;
    userName?: string;
    userEmail?: string;
    onOpenSettings: () => void;
    onSignOut?: () => void;
    /**
     * `row` is the sidebar's foot — avatar, name and email, the whole width,
     * opening upward. `avatar` is the collapsed sidebar's: the circle alone,
     * opening to its right.
     */
    variant: "row" | "avatar";
}

/**
 * Who is signed in, and what they can do about it: theme, settings, switch
 * workspace, sign out.
 *
 * It lives at the foot of the sidebar, where Claude, ChatGPT, Slack and VS
 * Code all keep the account. It used to sit at the end of the first column's
 * tab strip, which put it wherever that column happened to end — mid-screen
 * as soon as a second column opened — and made an app-wide control look like
 * part of one pane. Anchored to the sidebar, it is in the same place whatever
 * the columns are doing.
 */
export function AccountMenu({
    userInitials,
    userName,
    userEmail,
    onOpenSettings,
    onSignOut,
    variant,
}: AccountMenuProps) {
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const workspace = useEmployerWorkspaceSwitcher();
    const name = userName ?? "Your account";

    const avatar = (
        <span
            aria-hidden
            className="text-brand-fg flex size-7 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent),var(--accent-deep))] text-[11px] font-bold"
        >
            {userInitials}
        </span>
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {variant === "row" ? (
                    <button
                        type="button"
                        data-testid="account-menu"
                        aria-label={`Account: ${name}`}
                        className="hover:bg-line-2 focus-visible:ring-brand/50 data-[state=open]:bg-line-2 flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        {avatar}
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[12.5px] font-semibold">
                                {name}
                            </span>
                            {userEmail && (
                                <span className="text-ink-3 block truncate text-[11px]">
                                    {userEmail}
                                </span>
                            )}
                        </span>
                        <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                    </button>
                ) : (
                    <button
                        type="button"
                        data-testid="account-menu"
                        aria-label={`Account: ${name}`}
                        title={name}
                        className="focus-visible:ring-brand/50 rounded-full outline-none focus-visible:ring-[3px]"
                    >
                        {avatar}
                    </button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side={variant === "row" ? "top" : "right"}
                align={variant === "row" ? "start" : "end"}
                // From the collapsed strip, clear the strip's edge rather
                // than the avatar's: the circle sits ~9px inside it.
                sideOffset={variant === "row" ? 6 : 16}
                className="w-60"
            >
                <DropdownMenuLabel className="font-normal">
                    <span className="text-ink block truncate text-[13px] font-semibold">
                        {name}
                    </span>
                    {userEmail && (
                        <span className="text-ink-3 block truncate text-[11px]">{userEmail}</span>
                    )}
                </DropdownMenuLabel>
                {workspace && (
                    <DropdownMenuItem asChild>
                        <Link href="/workspaces" title="Switch workspace">
                            <ArrowLeftRight />
                            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                            <span className="text-ink-3 text-[11px]">Switch</span>
                        </Link>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => {
                        const next = isDark ? "light" : "dark";
                        setTheme(next);
                        // Remembered as a preference, so the choice follows
                        // the person to their next browser. Best effort.
                        void writeSettingValue({
                            key: "appearance.theme",
                            scope: "member",
                            value: next,
                        }).catch(() => undefined);
                    }}
                >
                    {isDark ? <Sun /> : <Moon />}
                    Switch to {isDark ? "light" : "dark"} theme
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenSettings}>
                    <Settings />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                        <BookOpen />
                        <span className="flex-1">Documentation</span>
                        <span className="text-ink-3 text-[10px]">↗</span>
                    </a>
                </DropdownMenuItem>
                {onSignOut && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onSignOut}>
                            <LogOut />
                            Log out
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
