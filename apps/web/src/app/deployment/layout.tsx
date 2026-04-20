import type { Metadata } from 'next';
import { Breadcrumbs } from '../_components/Breadcrumbs';

export const metadata: Metadata = {
    title: 'Deployment Guide — Self-Host Launchstack',
    description: 'Step-by-step guide to deploying Launchstack on Vercel, Docker, or your own servers. Get your open-source AI platform running in under 30 minutes.',
    alternates: {
        canonical: '/deployment',
    },
};

export default function DeploymentLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Breadcrumbs />
            {children}
        </>
    );
}
