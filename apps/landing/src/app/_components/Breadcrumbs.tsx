"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const LABELS: Record<string, string> = {
    pricing: "Pricing",
    about: "About",
    contact: "Contact",
    deployment: "Deployment Guide",
    signin: "Sign In",
    signup: "Get Started",
};

export function Breadcrumbs() {
    const pathname = usePathname();

    if (pathname === "/") return null;

    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const crumbs = segments.map((seg, i) => ({
        label: LABELS[seg] ?? seg.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        href: "/" + segments.slice(0, i + 1).join("/"),
    }));

    const breadcrumbLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: process.env.NEXT_PUBLIC_SITE_URL ?? "https://launchstack.app",
            },
            ...crumbs.map((c, i) => ({
                "@type": "ListItem",
                position: i + 2,
                name: c.label,
                item: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://launchstack.app"}${c.href}`,
            })),
        ],
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
            />
            <nav aria-label="Breadcrumb" className="mx-auto max-w-6xl px-4 pb-2 pt-20">
                <ol className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                    <li>
                        <Link
                            href="/"
                            className="flex items-center gap-1 transition-colors hover:text-purple-600 dark:hover:text-purple-400"
                        >
                            <Home className="h-3.5 w-3.5" />
                            <span className="sr-only">Home</span>
                        </Link>
                    </li>
                    {crumbs.map((c, i) => (
                        <li key={c.href} className="flex items-center gap-1.5">
                            <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600" />
                            {i === crumbs.length - 1 ? (
                                <span className="font-medium text-gray-900 dark:text-white">
                                    {c.label}
                                </span>
                            ) : (
                                <Link
                                    href={c.href}
                                    className="transition-colors hover:text-purple-600 dark:hover:text-purple-400"
                                >
                                    {c.label}
                                </Link>
                            )}
                        </li>
                    ))}
                </ol>
            </nav>
        </>
    );
}
