"use client";

import Link from "next/link";

export default function EmployeeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Something went wrong
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md">
        An error occurred while loading this page. Please try again or return to
        the dashboard.
      </p>
      {error.digest && (
        <p className="text-xs text-gray-400 mb-4">Error ID: {error.digest}</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-full transition-colors text-sm cursor-pointer"
        >
          Try again
        </button>
        <Link
          href="/employee/documents"
          className="border border-gray-200 dark:border-purple-700/50 text-gray-600 dark:text-gray-300 font-semibold px-5 py-2.5 rounded-full hover:border-purple-400 transition-colors text-sm"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
