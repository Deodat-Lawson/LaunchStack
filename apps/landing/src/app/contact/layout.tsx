import type { Metadata } from 'next';
import { Breadcrumbs } from '../_components/Breadcrumbs';

export const metadata: Metadata = {
    title: 'Support & Help Center',
    description: 'Get help with Launchstack. Find answers to common questions about deployment, document analysis, team management, and self-hosting.',
    alternates: {
        canonical: '/contact',
    },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Breadcrumbs />
            {children}
        </>
    );
}
