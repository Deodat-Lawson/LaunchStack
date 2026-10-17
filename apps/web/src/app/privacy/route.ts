import { redirectToLanding } from "~/server/landing-redirect";

export const dynamic = "force-dynamic";

/** GET /privacy — the Privacy Policy lives on the public site. */
export function GET() {
    return redirectToLanding("/privacy");
}
