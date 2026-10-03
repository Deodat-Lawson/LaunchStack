import { devRoutesEnabled } from "~/app/dev/enabled";

import { handleGoogleRequest } from "../dispatch";

/**
 * Development stand-in for Google's OAuth host, Drive v3 and the Picker
 * script — see ../dispatch.ts. The gate reads an environment variable, so
 * nothing here may be prerendered.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
    if (!devRoutesEnabled()) return new Response("Not Found", { status: 404 });
    return handleGoogleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
