"use client";

import React from "react";
import { LogOut } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import { useAuth, useUser } from "~/lib/auth-client";
import { useMyProfile } from "~/lib/profile/use-my-profile";

/**
 * Avatar + sign-out menu for the signed-in user. Replaces Clerk's
 * <UserButton>: their photo (or initials) in a circle that opens a small
 * account menu. Renders nothing while signed out or loading, so callers can
 * drop it in unconditionally. Before a profile exists (mid-signup) it shows
 * the session's name.
 */
export function UserMenu({ afterSignOutUrl = "/signin" }: { afterSignOutUrl?: string }) {
    const { signOut } = useAuth();
    const { user } = useUser();
    const { data: profile } = useMyProfile({ enabled: Boolean(user) });

    if (!user) return null;

    const name = profile?.effective.displayName ?? user.name.trim();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Account menu"
                    className="size-8 rounded-full p-0 hover:bg-transparent"
                >
                    <ProfileAvatar
                        name={name}
                        email={user.email}
                        src={profile?.effective.avatarUrl}
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5">
                        {name ? <span>{name}</span> : null}
                        <span className="text-ink-3 text-xs font-normal">{user.email}</span>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: afterSignOutUrl })}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
