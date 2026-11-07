"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * A tool API client's own "Request failed (status)" — the server answered
 * without a sentence — marked so a screen can word it. The tool clients
 * (`tools/*\/api.ts`) set `generated` on the errors they throw.
 */
export function isGeneratedRequestError(error: unknown): error is Error & { status: number } {
    return (
        error instanceof Error &&
        (error as { generated?: unknown }).generated === true &&
        typeof (error as { status?: unknown }).status === "number"
    );
}

/**
 * The sentence a tool screen shows for a failure, in the reader's language:
 * the server's own `{ error }` as it came (the routes word it), "Request
 * failed (status)" when the client had to make one up, else `fallback`.
 *
 *   const errorText = useErrorText();
 *   toast.error(errorText(e, t("saveFailed")));
 */
export function useErrorText(): (error: unknown, fallback: string) => string {
    const t = useTranslations("tools.resource");
    return useCallback(
        (error: unknown, fallback: string) => {
            if (isGeneratedRequestError(error)) return t("requestFailed", { status: error.status });
            if (error instanceof Error && error.message) return error.message;
            return fallback;
        },
        [t]
    );
}
