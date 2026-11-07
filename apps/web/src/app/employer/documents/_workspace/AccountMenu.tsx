"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
    ArrowLeftRight,
    BookOpen,
    ChevronsUpDown,
    LogOut,
    MessageSquareText,
    Moon,
    Settings,
    Sun,
} from "lucide-react";

import { useFeedback } from "~/components/feedback/FeedbackProvider";
import { LanguageSubmenu } from "~/components/i18n/LanguageMenu";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import { useEmployerWorkspaceSwitcher } from "../../_chrome/EmployerWorkspaceSwitcherContext";

const DOCS_URL = "https://github.com/Deodat-Lawson/LaunchStack#readme";

export interface AccountMenuProps {
    /** How the active workspace sees you — `useMyProfile().data.effective`. */
    userName?: string;
    userEmail?: string;
    /** The profile's title, shown in place of the email when there is one. */
    userTitle?: string | null;
    /** The profile photo; initials on the brand colour without one. */
    avatarUrl?: string | null;
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
 * Who is signed in, and what they can do about it: theme, language,
 * settings, switch workspace, send feedback, sign out.
 *
 * It lives at the foot of the sidebar, where Claude, ChatGPT, Slack and VS
 * Code all keep the account. It used to sit at the end of the first column's
 * tab strip, which put it wherever that column happened to end — mid-screen
 * as soon as a second column opened — and made an app-wide control look like
 * part of one pane. Anchored to the sidebar, it is in the same place whatever
 * the columns are doing.
 */
export function AccountMenu({
    userName,
    userEmail,
    userTitle,
    avatarUrl,
    onOpenSettings,
    onSignOut,
    variant,
}: AccountMenuProps) {
    const t = useTranslations("workspace.accountMenu");
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const workspace = useEmployerWorkspaceSwitcher();
    const feedback = useFeedback();
    const name = userName ?? t("fallbackName");

    const subtitle = userTitle ?? userEmail;

    const avatar = (
        <ProfileAvatar
            name={userName}
            email={userEmail}
            src={avatarUrl}
            className="size-7 shrink-0"
            fallbackClassName="text-[11px]"
        />
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {variant === "row" ? (
                    <button
                        type="button"
                        data-testid="account-menu"
                        aria-label={t("triggerLabel", { name })}
                        className="hover:bg-line-2 focus-visible:ring-brand/50 data-[state=open]:bg-line-2 flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        {avatar}
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[12.5px] font-semibold">
                                {name}
                            </span>
                            {subtitle && (
                                <span className="text-ink-3 block truncate text-[11px]">
                                    {subtitle}
                                </span>
                            )}
                        </span>
                        <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                    </button>
                ) : (
                    <button
                        type="button"
                        data-testid="account-menu"
                        aria-label={t("triggerLabel", { name })}
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
                    {userTitle && (
                        <span className="text-ink-2 block truncate text-[11.5px]">{userTitle}</span>
                    )}
                    {userEmail && (
                        <span className="text-ink-3 block truncate text-[11px]">{userEmail}</span>
                    )}
                </DropdownMenuLabel>
                {workspace && (
                    <DropdownMenuItem asChild>
                        <Link href="/workspaces" title={t("switchWorkspace")}>
                            <ArrowLeftRight />
                            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                            <span className="text-ink-3 text-[11px]">{t("switch")}</span>
                        </Link>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    // PreferenceSync saves the change as a preference, so it
                    // follows the person to their next browser.
                    onSelect={() => setTheme(isDark ? "light" : "dark")}
                >
                    {isDark ? <Sun /> : <Moon />}
                    {isDark ? t("lightTheme") : t("darkTheme")}
                </DropdownMenuItem>
                <LanguageSubmenu />
                <DropdownMenuItem onSelect={onOpenSettings}>
                    <Settings />
                    {t("settings")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                        <BookOpen />
                        <span className="flex-1">{t("documentation")}</span>
                        <span className="text-ink-3 text-[10px]">↗</span>
                    </a>
                </DropdownMenuItem>
                {feedback.enabled && (
                    <DropdownMenuItem
                        onSelect={() => feedback.open()}
                        data-testid="account-menu-feedback"
                    >
                        <MessageSquareText />
                        {t("feedback")}
                    </DropdownMenuItem>
                )}
                {onSignOut && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onSignOut}>
                            <LogOut />
                            {t("logOut")}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
