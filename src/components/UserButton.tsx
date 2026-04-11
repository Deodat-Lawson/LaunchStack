"use client";

import React, { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { useUser } from "~/lib/auth-hooks";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/app/employer/documents/components/ui/dropdown-menu";

export function UserButton() {
    const { user } = useUser();
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSignOut = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await authClient.signOut();
        } catch (err) {
            console.error("Sign out failed:", err);
        } finally {
            // Full reload to clear any client-side session caches and let
            // middleware re-evaluate the now-cookieless request.
            window.location.href = "/";
        }
    };

    const displayName = user?.fullName ?? "User";
    const email = user?.primaryEmailAddress?.emailAddress ?? "";

    const initials = displayName
        .split(" ")
        .map((n) => n[0])
        .filter(Boolean)
        .join("")
        .slice(0, 2)
        .toUpperCase() || "U";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Open account menu"
                    className="group relative w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-slate-900 hover:shadow-md hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-background transition-all duration-200 overflow-hidden"
                >
                    {isSigningOut ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : user?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={user.imageUrl}
                            alt={displayName}
                            className="w-full h-full rounded-full object-cover"
                        />
                    ) : (
                        <span className="tracking-wide">{initials}</span>
                    )}
                    {/* Subtle online indicator */}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 p-0 overflow-hidden">
                {/* Header with gradient accent */}
                <div className="px-4 py-3 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                            {user?.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={user.imageUrl}
                                    alt={displayName}
                                    className="w-full h-full rounded-full object-cover"
                                />
                            ) : (
                                initials
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground truncate">
                                {displayName}
                            </p>
                            {email && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {email}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <DropdownMenuSeparator className="m-0" />

                <div className="p-1">
                    <DropdownMenuItem
                        className="cursor-pointer text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-900/20 focus:text-red-600 dark:focus:text-red-300 rounded-md"
                        onClick={handleSignOut}
                        disabled={isSigningOut}
                    >
                        {isSigningOut ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <LogOut className="w-4 h-4 mr-2" />
                        )}
                        {isSigningOut ? "Signing out..." : "Sign Out"}
                    </DropdownMenuItem>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
