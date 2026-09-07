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
import { useAuth, useUser } from "~/lib/auth-client";

/**
 * Avatar + sign-out menu for the signed-in user. Replaces Clerk's
 * <UserButton>: an initial in a circle that opens a small account menu.
 * Renders nothing while signed out or loading, so callers can drop it in
 * unconditionally.
 */
export function UserMenu({ afterSignOutUrl = "/signin" }: { afterSignOutUrl?: string }) {
    const { signOut } = useAuth();
    const { user } = useUser();

    if (!user) return null;

    const name = user.name.trim();
    const initial = (name || user.email).charAt(0).toUpperCase() || "U";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Account menu"
                    className="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
                >
                    {initial}
                </button>
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
