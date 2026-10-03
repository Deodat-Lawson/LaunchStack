"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { RailBackLink } from "~/app/employer/_chrome/RailBackLink";
import { STUDIO } from "~/app/employer/_chrome/backTarget";
import { VantageMark } from "~/components/icons/vantage";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { vantagePath } from "../_lib/paths";

interface NavItem {
    href: string;
    label: string;
    exact?: boolean;
}

export function VantageWordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <VantageMark size={15} tile />
            <span className="text-ink text-[13.5px] font-semibold tracking-[-0.02em]">Vantage</span>
        </span>
    );
}

function NavLink({ item }: { item: NavItem }) {
    const pathname = usePathname();
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    return (
        <li>
            <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "focus-visible:ring-brand/50 flex h-8 items-center justify-between gap-2 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:ring-[3px]",
                    active
                        ? "bg-panel text-ink shadow-1 font-medium"
                        : "text-ink-2 hover:bg-panel/60 hover:text-ink"
                )}
            >
                <span>{item.label}</span>
            </Link>
        </li>
    );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-ink-3 px-2 pb-1 text-[11.5px] font-medium">{children}</div>;
}

/**
 * One rail for the weekly loop. The founder's screens come first in the
 * order the week runs — capture, then the agenda, then follow-through. The
 * program view sits apart under its own label: it is the administrator's
 * side of the same table, and only reads what the founder chose to share.
 */
export function VantageShell({ children }: { children: React.ReactNode }) {
    const { can } = usePermissions();
    const week: NavItem[] = [
        { href: vantagePath(""), label: "This week", exact: true },
        { href: vantagePath("/agenda"), label: "Agenda" },
        { href: vantagePath("/commitments"), label: "Commitments" },
    ];
    const capture: NavItem[] = [
        { href: vantagePath("/evidence"), label: "Evidence" },
        { href: vantagePath("/metrics"), label: "Metrics" },
    ];
    const program: NavItem[] = [{ href: vantagePath("/program"), label: "Triage" }];
    return (
        <div className="bg-surface text-ink grid min-h-full w-full flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="bg-surface-2 border-line flex flex-col gap-4 border-b px-2.5 pb-16 pt-3.5 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
                <div className="flex flex-col gap-2">
                    <RailBackLink target={STUDIO} />
                    <div className="px-1.5">
                        <VantageWordmark />
                    </div>
                </div>
                <nav aria-label="The week">
                    <GroupLabel>The week</GroupLabel>
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {week.map(item => (
                            <NavLink key={item.href} item={item} />
                        ))}
                    </ul>
                </nav>
                <nav aria-label="Capture">
                    <GroupLabel>Capture</GroupLabel>
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {capture.map(item => (
                            <NavLink key={item.href} item={item} />
                        ))}
                    </ul>
                </nav>
                {can("settings.manage") && (
                    <nav aria-label="Program">
                        <GroupLabel>Program</GroupLabel>
                        <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                            {program.map(item => (
                                <NavLink key={item.href} item={item} />
                            ))}
                        </ul>
                    </nav>
                )}
            </aside>
            <main className="min-w-0 px-5 pb-12 pt-6 md:px-8">{children}</main>
        </div>
    );
}
