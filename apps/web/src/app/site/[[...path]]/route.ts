import { redirectToLanding } from "~/server/landing-redirect";

export const dynamic = "force-dynamic";

/**
 * GET /site/<path> — the same page on the public site (apps/landing).
 *
 * The brand logo, sign-out, Help and the deployment guide link here
 * (`LANDING_HREF` in ~/config/landing) rather than to the landing origin, so
 * the destination is the deployment's `LANDING_PUBLIC_URL`, read per request,
 * instead of whatever host was inlined when CI built the image. The query
 * string rides along (`/site/deployment?section=uploadthing`).
 *
 * Not in middleware's protected list: a signed-out visitor, including one who
 * has just signed out, must get through.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
    const { path = [] } = await params;
    const rest = path.map(segment => encodeURIComponent(segment)).join("/");
    return redirectToLanding(`/${rest}`, new URL(request.url).search);
}
