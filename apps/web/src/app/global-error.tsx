"use client";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en">
            <body className="flex min-h-screen items-center justify-center bg-white px-4 text-gray-900 dark:bg-[#080010] dark:text-white">
                <div className="max-w-md text-center">
                    <h1 className="mb-4 text-4xl font-bold text-purple-600 dark:text-purple-400">
                        Something went wrong
                    </h1>
                    <p className="mb-6 text-gray-500 dark:text-gray-400">
                        An unexpected error occurred. Please try again or contact support if the
                        problem persists.
                    </p>
                    {error.digest && (
                        <p className="mb-4 text-xs text-gray-400">Error ID: {error.digest}</p>
                    )}
                    <button
                        onClick={reset}
                        className="cursor-pointer rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
