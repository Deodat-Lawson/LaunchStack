/**
 * The meeting hub, mounted on the app.
 *
 * A remote agent worker on another machine points `COLLAB_HUB_URL` at
 * `https://<this app>/api/collab/hub` and the rest of the protocol is
 * identical to the standalone `collab-hub` binary — this route only translates
 * `NextRequest` into the framework-agnostic shape the hub already accepts, and
 * rebuilds the canonical `/collab/v1/...` path the worker signed.
 *
 * Authentication is the hub's own HMAC, not a user session: the caller is a machine
 * holding `COLLAB_HUB_SECRET`, not a browser session. Session-authenticated
 * humans use the `/api/collab/meetings/**` routes instead.
 */

import { NextResponse } from "next/server";

import { COLLAB_API_PREFIX, type HubHttpRequest } from "@launchstack/collab";
import { getHub } from "~/server/collab/runtime";

export const dynamic = "force-dynamic";
/** Long polls are held open by the hub for up to 25s. */
export const maxDuration = 60;

function headersToRecord(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
    });
    return out;
}

async function handle(request: Request, path: string[]): Promise<Response> {
    const hub = getHub();
    if (!hub) {
        return NextResponse.json(
            {
                ok: false,
                code: "unauthorized",
                error: "Distributed agents are not enabled on this deployment. Set COLLAB_HUB_SECRET to accept remote agent nodes.",
            },
            { status: 503 }
        );
    }

    const url = new URL(request.url);
    // A worker configured with `COLLAB_HUB_URL=https://app/api/collab/hub`
    // requests `/api/collab/hub/collab/v1/nodes/poll`, so the captured segments
    // already carry the canonical prefix. Accept both shapes rather than making
    // the mount point load-bearing — and rebuild the query string too, because
    // it is covered by the worker's signature.
    const carriesPrefix = path[0] === "collab" && path[1] === "v1";
    const canonical = carriesPrefix
        ? `/${path.join("/")}${url.search}`
        : `${COLLAB_API_PREFIX}/${path.join("/")}${url.search}`;

    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();

    const hubRequest: HubHttpRequest = {
        method: request.method,
        path: canonical,
        headers: headersToRecord(request.headers),
        body,
    };

    const response = await hub.handle(hubRequest);
    return new Response(response.body, { status: response.status, headers: response.headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    return handle(request, (await params).path);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    return handle(request, (await params).path);
}
