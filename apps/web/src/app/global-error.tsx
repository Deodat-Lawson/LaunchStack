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
            <body className="flex min-h-screen items-center justify-center bg-surface px-4 text-ink">
                <div className="max-w-md text-center">
                    <h1 className="mb-4 text-4xl font-bold text-brand-ink">
                        Something went wrong
                    </h1>
                    <p className="mb-6 text-ink-2">
                        An unexpected error occurred. Please try again or contact support if the
                        problem persists.
                    </p>
                    {error.digest && (
                        <p className="mb-4 text-xs text-ink-3">Error ID: {error.digest}</p>
                    )}
                    <button
                        onClick={reset}
                        className="cursor-pointer rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hi"
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
