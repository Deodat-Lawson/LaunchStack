/** OpenID Connect discovery, for MCP clients. See ~/server/mcp/well-known. */
import { openIdConfiguration, preflight } from "~/server/mcp/well-known";

export async function GET(request: Request) {
    return openIdConfiguration(request);
}

export async function OPTIONS() {
    return preflight();
}
