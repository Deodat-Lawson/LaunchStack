/**
 * Issuer-relative OpenID Connect discovery (issuer is <origin>/api/auth).
 * better-auth marks the document server-only, so its catch-all handler
 * would 404 here. See ~/server/mcp/well-known.
 */
import { openIdConfiguration, preflight } from "~/server/mcp/well-known";

export async function GET(request: Request) {
    return openIdConfiguration(request);
}

export async function OPTIONS() {
    return preflight();
}
