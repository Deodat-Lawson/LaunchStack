import { devRoutesEnabled } from "~/app/dev/enabled";

import { handleLinkedInRequest } from "../dispatch";

/**
 * Development stand-in for LinkedIn's OAuth host and API — see ../dispatch.ts.
 * The gate reads an environment variable, so nothing here may be prerendered.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
    if (!devRoutesEnabled()) return new Response("Not Found", { status: 404 });
    return handleLinkedInRequest(req);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
