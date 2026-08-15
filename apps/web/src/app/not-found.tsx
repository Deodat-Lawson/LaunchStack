import Link from 'next/link';
import { LogIn, BookOpen, Github } from 'lucide-react';
import type { Metadata } from 'next';
import { LaunchstackMark } from './_components/LaunchstackLogo';
import { LANDING_DEPLOYMENT_URL } from '~/config/landing';

export const metadata: Metadata = {
    title: 'Page Not Found',
    description: 'The page you are looking for does not exist.',
};

const GITHUB_REPO = "https://github.com/Deodat-Lawson/LaunchStack";

export default function NotFound() {
    return (
        <div className="min-h-screen bg-white dark:bg-[#080010] text-gray-900 dark:text-white flex flex-col items-center justify-center px-4 transition-colors duration-200">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(147,51,234,0.08),transparent)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(147,51,234,0.15),transparent)] pointer-events-none" />

            <div className="relative text-center max-w-lg">
                <div className="flex items-center justify-center gap-2 mb-8">
                    <LaunchstackMark size={26} title="Launchstack" />
                    <span className="font-bold text-lg">Launchstack</span>
                </div>

                <h1 className="text-7xl md:text-8xl font-bold text-purple-600 dark:text-purple-400 mb-4">404</h1>
                <h2 className="text-2xl md:text-3xl font-bold mb-3">Page not found</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-10 leading-relaxed">
                    The page you are looking for does not exist or may have been moved. Here are some places you might want to go instead.
                </p>

                {/*
                  /pricing, /about, /contact and /deployment used to be siblings
                  of this page. They live on the public site now (apps/landing),
                  so the only in-app destination left is sign-in — everything
                  else on this origin is behind it anyway.
                */}
                <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
                    <Link href="/signin">
                        <button className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-full transition-colors text-sm cursor-pointer w-full sm:w-auto">
                            <LogIn className="w-4 h-4" />
                            Go to sign in
                        </button>
                    </Link>
                </div>

                <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
                    <a href={LANDING_DEPLOYMENT_URL} rel="noopener" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" /> Deployment guide
                    </a>
                    <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1.5">
                        <Github className="w-3.5 h-3.5" /> GitHub
                    </a>
                </div>
            </div>
        </div>
    );
}
