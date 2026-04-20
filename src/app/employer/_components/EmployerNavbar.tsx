"use client";

import Link from "next/link";
import React from "react";
import { Brain, Home } from "lucide-react";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { TokenBalance } from "~/app/employer/_components/TokenBalance";
import { Button } from "~/app/employer/documents/components/ui/button";

export function EmployerNavbar() {
    return (
        <nav className="bg-background border-b border-border px-8 py-4 flex-shrink-0 z-50 sticky top-0">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <Link href="/employer/home" className="flex items-center gap-2 group">
                    <div className="p-2 bg-purple-600 rounded-lg shadow-lg shadow-purple-500/20 transition-transform group-hover:scale-105">
                        <Brain className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-xl font-bold text-foreground tracking-tight group-hover:text-purple-600 transition-colors">
                        Launchstack
                    </span>
                </Link>

                <div className="flex items-center gap-4">
                    <TokenBalance />
                    <ThemeToggle />

                    <Link href="/employer/home">
                        <Button variant="ghost" size="icon" className="rounded-full">
                            <Home className="w-5 h-5" />
                            <span className="sr-only">Home</span>
                        </Button>
                    </Link>

                    <div className="pl-4 border-l border-border">
                        <ProfileDropdown />
                    </div>
                </div>
            </div>
        </nav>
    );
}
