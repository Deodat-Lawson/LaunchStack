import "server-only";

/**
 * Which build a report was filed against: the commit the image was built
 * from when CI stamped one (`GIT_COMMIT_SHA`, see apps/web/Dockerfile), the
 * platform's when it set one, else the web app's package version — the same
 * sources `/api/health` reports, so triage can line a report up with a deploy.
 */

import webPackage from "../../../package.json";

/** The Dockerfile's default when no commit was passed in, as `/api/health` says it. */
const UNSTAMPED = "unknown";

function stamped(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed !== UNSTAMPED ? trimmed : undefined;
}

export function feedbackAppVersion(): string {
    return (
        stamped(process.env.GIT_COMMIT_SHA) ??
        stamped(process.env.VERCEL_GIT_COMMIT_SHA) ??
        webPackage.version
    );
}
