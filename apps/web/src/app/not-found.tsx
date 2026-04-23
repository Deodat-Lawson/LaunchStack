import Link from 'next/link';
import { ArrowLeft, Home, BookOpen, Github } from 'lucide-react';
import type { Metadata } from 'next';
import { LaunchstackMark } from './_components/LaunchstackLogo';

export const metadata: Metadata = {
    title: 'Page Not Found',
    description: 'The page you are looking for does not exist. Head back to Launchstack to explore document analysis, deployment guides, and more.',
};

const GITHUB_REPO = "https://github.com/Deodat-Lawson/pdr_ai_v2";

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

                <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
                    <Link href="/">
                        <button className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-full transition-colors text-sm cursor-pointer w-full sm:w-auto">
                            <Home className="w-4 h-4" />
                            Go Home
                        </button>
                    </Link>
                    <Link href="/deployment">
                        <button className="flex items-center justify-center gap-2 border border-gray-200 dark:border-purple-700/50 text-gray-600 dark:text-gray-300 font-semibold px-6 py-3 rounded-full hover:border-purple-400 dark:hover:border-purple-500 transition-colors text-sm cursor-pointer w-full sm:w-auto">
                            <BookOpen className="w-4 h-4" />
                            Deployment Guide
                        </button>
                    </Link>
                </div>

                <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
                    <Link href="/pricing" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">Pricing</Link>
                    <Link href="/about" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">About</Link>
                    <Link href="/contact" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">Contact</Link>
                    <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1.5">
                        <Github className="w-3.5 h-3.5" /> GitHub
                    </a>
                </div>
            </div>
        </div>
    );
}
