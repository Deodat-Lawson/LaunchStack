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
      <body className="min-h-screen bg-white dark:bg-[#080010] text-gray-900 dark:text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold text-purple-600 dark:text-purple-400 mb-4">
            Something went wrong
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            An unexpected error occurred. Please try again or contact support if
            the problem persists.
          </p>
          {error.digest && (
            <p className="text-xs text-gray-400 mb-4">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-full transition-colors text-sm cursor-pointer"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
