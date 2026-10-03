import { redirectToLanding } from "~/server/landing-redirect";

export const dynamic = "force-dynamic";

/** GET /terms — the Terms of Service live on the public site. */
export function GET() {
    return redirectToLanding("/terms");
}
