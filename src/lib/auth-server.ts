import { auth as betterAuth } from "~/lib/auth";
import { headers } from "next/headers";

/**
 * Server-side auth helper — drop-in replacement for Clerk's auth().
 * Returns { userId } so existing API routes need only an import change.
 */
export async function auth(): Promise<{ userId: string | null }> {
    const session = await betterAuth.api.getSession({
        headers: await headers(),
    });
    return { userId: session?.user?.id ?? null };
}
