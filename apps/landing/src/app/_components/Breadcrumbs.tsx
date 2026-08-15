'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const LABELS: Record<string, string> = {
    pricing: 'Pricing',
    about: 'About',
    contact: 'Contact',
    deployment: 'Deployment Guide',
    signin: 'Sign In',
    signup: 'Get Started',
};

export function Breadcrumbs() {
    const pathname = usePathname();

    if (pathname === '/') return null;

    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const crumbs = segments.map((seg, i) => ({
        label: LABELS[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        href: '/' + segments.slice(0, i + 1).join('/'),
    }));

    const breadcrumbLd = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app' },
            ...crumbs.map((c, i) => ({
                '@type': 'ListItem',
                position: i + 2,
                name: c.label,
                item: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app'}${c.href}`,
            })),
        ],
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
            />
            <nav aria-label="Breadcrumb" className="max-w-6xl mx-auto px-4 pt-20 pb-2">
                <ol className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                    <li>
                        <Link href="/" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1">
                            <Home className="w-3.5 h-3.5" />
                            <span className="sr-only">Home</span>
                        </Link>
                    </li>
                    {crumbs.map((c, i) => (
                        <li key={c.href} className="flex items-center gap-1.5">
                            <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                            {i === crumbs.length - 1 ? (
                                <span className="text-gray-900 dark:text-white font-medium">{c.label}</span>
                            ) : (
                                <Link href={c.href} className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
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
