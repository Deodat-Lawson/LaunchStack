/**
 * Issuer-relative authorization-server metadata, for clients that append the
 * well-known path to the issuer instead of inserting it. See
 * ~/server/mcp/well-known.
 */
import { authorizationServerMetadata, preflight } from "~/server/mcp/well-known";

export async function GET(request: Request) {
    return authorizationServerMetadata(request);
}

export async function OPTIONS() {
    return preflight();
}
