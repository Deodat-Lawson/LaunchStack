"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { UserMenu } from "~/components/UserMenu";
import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import { Button } from "~/components/ui/button";

/**
 * The employee area's own chrome. Replaces the navbars this area used to
 * borrow from app/employer (ProfileDropdown, employees/NavBar) — route
 * areas must not import from each other.
 */
export function EmployeeNavbar({ showHome = false }: { showHome?: boolean }) {
    // The user menu reads auth state that only exists client-side;
    // render a placeholder until mounted to avoid a hydration mismatch.
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    return (
        <nav className="z-nav border-line bg-panel sticky top-0 flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-2.5">
                <LaunchstackMark size={26} title="Launchstack" />
                <span className="text-ink text-[15px] font-bold tracking-tight">Launchstack</span>
            </div>
            <div className="flex items-center gap-2">
                <ThemeToggle />
                {showHome && (
                    <Button variant="ghost" size="icon" asChild aria-label="Go to home">
                        <Link href="/employee/home">
                            <Home className="text-ink-2 h-5 w-5" />
                        </Link>
                    </Button>
                )}
                <div className="relative inline-block">
                    {isMounted ? <UserMenu /> : <div aria-hidden="true" className="h-7 w-7" />}
                </div>
            </div>
        </nav>
    );
}
