import { devRoutesEnabled } from "~/app/dev/enabled";

import { handleMicrosoftRequest } from "../dispatch";

/**
 * Development stand-in for Entra's token endpoint and Microsoft Graph — see
 * ../dispatch.ts. The gate reads an environment variable, so nothing here may
 * be prerendered.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
    if (!devRoutesEnabled()) return new Response("Not Found", { status: 404 });
    return handleMicrosoftRequest(req);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
