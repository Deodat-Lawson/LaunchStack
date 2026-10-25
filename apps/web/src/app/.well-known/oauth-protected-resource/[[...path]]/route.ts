/** RFC 9728 protected-resource metadata for /api/mcp, for MCP clients. See ~/server/mcp/well-known. */
import { protectedResourceMetadata, preflight } from "~/server/mcp/well-known";

export async function GET(request: Request) {
    return protectedResourceMetadata(request);
}

export async function OPTIONS() {
    return preflight();
}
