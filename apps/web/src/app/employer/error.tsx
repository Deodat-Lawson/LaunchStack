"use client";

import Link from "next/link";

export default function EmployerError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
            <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
                Something went wrong
            </h2>
            <p className="mb-6 max-w-md text-gray-500 dark:text-gray-400">
                An error occurred while loading this page. Please try again or return to the
                dashboard.
            </p>
            {error.digest && <p className="mb-4 text-xs text-gray-400">Error ID: {error.digest}</p>}
            <div className="flex gap-3">
                <button
                    onClick={reset}
                    className="cursor-pointer rounded-full bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
                >
                    Try again
                </button>
                <Link
                    href="/employer/documents"
                    className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:border-purple-400 dark:border-purple-700/50 dark:text-gray-300"
                >
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
