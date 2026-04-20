import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Get Started with Launchstack — Free',
    description: 'Create your free Launchstack account. Set up your organization and start analyzing documents with AI in minutes. No credit card required.',
    alternates: {
        canonical: '/signup',
    },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return children;
}
