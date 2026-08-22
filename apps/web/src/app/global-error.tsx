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
            <body className="bg-surface text-ink flex min-h-screen items-center justify-center px-4">
                <div className="max-w-md text-center">
                    <h1 className="text-brand-ink mb-4 text-4xl font-bold">Something went wrong</h1>
                    <p className="text-ink-2 mb-6">
                        An unexpected error occurred. Please try again or contact support if the
                        problem persists.
                    </p>
                    {error.digest && (
                        <p className="text-ink-3 mb-4 text-xs">Error ID: {error.digest}</p>
                    )}
                    <button
                        onClick={reset}
                        className="bg-brand text-brand-fg hover:bg-brand-hi cursor-pointer rounded-full px-6 py-3 text-sm font-semibold transition-colors"
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
