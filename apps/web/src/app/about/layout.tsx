import type { Metadata } from 'next';
import { Breadcrumbs } from '../_components/Breadcrumbs';

export const metadata: Metadata = {
    title: 'About — The Team Behind Launchstack',
    description: 'Meet the team building Launchstack, the free open-source AI platform for tech founders. Developed at Johns Hopkins University.',
    alternates: {
        canonical: '/about',
    },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Breadcrumbs />
            {children}
        </>
    );
}
