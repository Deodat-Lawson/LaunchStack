"use client";

import React from "react";
import { LogOut, User } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { useUser } from "~/lib/auth-hooks";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/app/employer/documents/components/ui/dropdown-menu";

export function UserButton() {
    const { user } = useUser();

    const handleSignOut = async () => {
        await authClient.signOut();
        window.location.href = "/";
    };

    const initials = (user?.fullName ?? "U")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className="w-8 h-8 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2">
                    {user?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={user.imageUrl}
                            alt={user.fullName ?? "User"}
                            className="w-8 h-8 rounded-full object-cover"
                        />
                    ) : (
                        initials
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium truncate">
                        {user?.fullName ?? "User"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        {user?.primaryEmailAddress?.emailAddress ?? ""}
                    </p>
                </div>
                <DropdownMenuItem
                    className="cursor-pointer text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-900/20 focus:text-red-600"
                    onClick={handleSignOut}
                >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
