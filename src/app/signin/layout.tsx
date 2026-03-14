import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign In',
    description: 'Sign in to your Launchstack account to access document analysis, team management, and AI-powered tools.',
    alternates: {
        canonical: '/signin',
    },
};

export default function SigninLayout({ children }: { children: React.ReactNode }) {
    return children;
}
