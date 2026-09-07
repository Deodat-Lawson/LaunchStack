/**
 * Bare `node:http` adapter for the hub.
 *
 * Self-hosted deployments and the two-machine integration test both mount the
 * hub this way. Binding defaults to `0.0.0.0` — the point of the hub is to be
 * reachable from another host, so loopback-only would defeat it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { MeetingHub } from "./hub";
import { COLLAB_API_PREFIX, lowercaseHeaders, type HubHttpRequest } from "./protocol";

export interface HubServerOptions {
    port?: number;
    host?: string;
    /**
     * Path the hub is mounted under, stripped before routing. Defaults to "" —
     * the canonical `/collab/v1/…` path is used as-is.
     */
    mountPath?: string;
    /** Requests larger than this are rejected. Guards against a hostile body. */
    maxBodyBytes?: number;
}

export interface HubServerHandle {
    server: Server;
    port: number;
    host: string;
    /** `http://host:port` — hand this to a worker's `hubUrl`. */
    url: string;
    close(): Promise<void>;
}

export function createHubServer(hub: MeetingHub, options: HubServerOptions = {}): Server {
    const mountPath = (options.mountPath ?? "").replace(/\/+$/, "");
    const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024;

    return createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
            try {
                const body = await readBody(req, maxBodyBytes);
                if (body === null) {
                    res.writeHead(413, { "content-type": "application/json" });
                    res.end(
                        JSON.stringify({ ok: false, code: "bad_request", error: "Body too large" })
                    );
                    return;
                }

                const rawPath = req.url ?? "/";
                const canonical =
                    mountPath && rawPath.startsWith(mountPath)
                        ? rawPath.slice(mountPath.length)
                        : rawPath;

                if (!canonical.startsWith(COLLAB_API_PREFIX)) {
                    res.writeHead(404, { "content-type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            code: "not_found",
                            error: `Unknown path ${rawPath}`,
                        })
                    );
                    return;
                }

                const hubRequest: HubHttpRequest = {
                    method: req.method ?? "GET",
                    path: canonical,
                    headers: lowercaseHeaders(
                        req.headers as Record<string, string | string[] | undefined>
                    ),
                    body,
                };

                const response = await hub.handle(hubRequest);
                res.writeHead(response.status, response.headers);
                res.end(response.body);
            } catch (err) {
                res.writeHead(500, { "content-type": "application/json" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        code: "internal",
                        error: err instanceof Error ? err.message : String(err),
                    })
                );
            }
        })();
    });
}

/** Starts the hub server and resolves once it is accepting connections. */
export async function startHubServer(
    hub: MeetingHub,
    options: HubServerOptions = {}
): Promise<HubServerHandle> {
    const server = createHubServer(hub, options);
    const host = options.host ?? "0.0.0.0";

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, host, () => {
            server.removeListener("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Hub server did not bind to a TCP port");
    }

    // A worker cannot dial 0.0.0.0; report a connectable address instead.
    const dialHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

    return {
        server,
        port: address.port,
        host,
        url: `http://${dialHost.includes(":") ? `[${dialHost}]` : dialHost}:${address.port}`,
        close: () =>
            new Promise<void>(resolve => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            }),
    };
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        size += buf.length;
        if (size > maxBytes) return null;
        chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
}
