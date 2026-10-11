import type { LinkedInClientOptions } from "@launchstack/tools/social-publish/linkedin";

import { env } from "~/env";

/** Client options for one LinkedIn call: the token, plus the deployment's endpoint and version overrides. */
export function linkedInApiOptions(accessToken: string): LinkedInClientOptions {
    return {
        accessToken,
        apiBaseUrl: env.server.LINKEDIN_API_BASE_URL,
        version: env.server.LINKEDIN_API_VERSION,
    };
}
