/**
 * The social sign-in providers this deployment holds credentials for.
 *
 * One reader for both sides of the contract: the auth instance registers
 * exactly these, and the sign-in page renders a button for exactly these. If
 * the two drifted, a button would lead to better-auth's "provider not found".
 *
 * Plain process.env, no imports: the auth instance sits in the middleware
 * bundle, and the sign-in page reads this at request time so a prebuilt
 * image picks up credentials added after the build.
 */
export type SocialProvider = "google" | "github";

export function enabledSocialProviders(): SocialProvider[] {
    const providers: SocialProvider[] = [];
    if (process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET) {
        providers.push("google");
    }
    if (process.env.AUTH_GITHUB_CLIENT_ID && process.env.AUTH_GITHUB_CLIENT_SECRET) {
        providers.push("github");
    }
    return providers;
}
