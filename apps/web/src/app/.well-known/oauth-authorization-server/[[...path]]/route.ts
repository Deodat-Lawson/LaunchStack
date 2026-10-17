/** RFC 8414 authorization-server metadata, for MCP clients. See ~/server/mcp/well-known. */
import { authorizationServerMetadata, preflight } from "~/server/mcp/well-known";

export async function GET(request: Request) {
    return authorizationServerMetadata(request);
}

export async function OPTIONS() {
    return preflight();
}
