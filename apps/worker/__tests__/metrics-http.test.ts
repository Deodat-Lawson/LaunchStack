import { once } from "node:events";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "@launchstack/runtime";
import { metricsRegistry } from "~/server/metrics/registry";
import {
    refreshStorageDeletionBacklog,
    storageDeletionItemsProcessed,
    storageDeletionOldestPendingAge,
    storageDeletionPendingItems,
    storageDeletionRequestsFinished,
} from "~/server/metrics/storage-deletion";
import type { Executor } from "~/server/workspace/db-types";

import { createMetricsHandler } from "../src/metrics-http";

const servers: Server[] = [];

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies LoggerPort;
}

async function serve(options: Parameters<typeof createMetricsHandler>[0]) {
    const server = createServer(createMetricsHandler(options));
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const port = address.port;

    return async (authorization?: string) => {
        const req = request({
            host: "127.0.0.1",
            port,
            path: "/metrics",
            headers: authorization === undefined ? {} : { authorization },
            agent: false,
        });
        const response = once(req, "response");
        req.end();
        const [res] = (await response) as [IncomingMessage];
        res.setEncoding("utf8");
        let body = "";
        for await (const chunk of res) body += chunk;
        return {
            status: res.statusCode,
            contentType: res.headers["content-type"],
            body,
        };
    };
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
        servers.splice(0).map(server => {
            const closed = once(server, "close");
            server.close();
            return closed;
        })
    );
});

describe("worker /metrics HTTP endpoint", () => {
    it("fails closed and warns once when production has no scrape token", async () => {
        const logger = makeLogger();
        const snapshot = vi.spyOn(metricsRegistry, "metrics");
        const scrape = await serve({ scrapeToken: undefined, isProduction: true, logger });

        for (const authorization of [undefined, "Bearer secret"]) {
            const response = await scrape(authorization);
            expect(response.status).toBe(503);
            expect(JSON.parse(response.body)).toEqual({
                message: "Metrics scrape token not configured",
            });
        }
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            {},
            expect.stringContaining("METRICS_SCRAPE_TOKEN is not set")
        );
        expect(snapshot).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        "rejects missing, incorrect and malformed Bearer values (production=%s)",
        async isProduction => {
            const snapshot = vi.spyOn(metricsRegistry, "metrics");
            const scrape = await serve({
                scrapeToken: "secret",
                isProduction,
                logger: makeLogger(),
            });

            for (const authorization of [
                undefined,
                "Basic secret",
                "bearer secret",
                "Bearer",
                "Bearer ",
                "Bearer wrong",
                "Bearer secrex",
                "Bearer secret-extra",
                // Equal character length, unequal UTF-8 byte length: timingSafeEqual must not throw.
                "Bearer sëcret",
                "Bearer secret, Bearer secret",
            ]) {
                const response = await scrape(authorization);
                expect(response.status, authorization).toBe(401);
                expect(JSON.parse(response.body)).toEqual({ message: "Unauthorized" });
            }
            expect(snapshot).not.toHaveBeenCalled();
        }
    );

    it("scrapes the same registry that records deletion outcomes and backlog", async () => {
        const execute = vi.fn().mockResolvedValue([{ pending: 7, oldest: 31 }]);
        await refreshStorageDeletionBacklog({ execute } as unknown as Executor);
        storageDeletionItemsProcessed.inc({ outcome: "deleted" });
        storageDeletionRequestsFinished.inc({ status: "completed" });
        const scrape = await serve({
            scrapeToken: "secret",
            isProduction: true,
            logger: makeLogger(),
        });

        const response = await scrape("Bearer secret");

        expect(response.status).toBe(200);
        expect(response.contentType).toBe(metricsRegistry.contentType);
        expect(response.body).toContain(
            'pdr_storage_deletion_items_processed_total{outcome="deleted"}'
        );
        expect(response.body).toContain(
            'pdr_storage_deletion_requests_finished_total{status="completed"}'
        );
        expect(response.body).toContain("pdr_storage_deletion_pending_items 7");
        expect(response.body).toContain("pdr_storage_deletion_oldest_pending_age_seconds 31");
        expect(response.body).toContain("pdr_process_cpu_user_seconds_total");
        expect(response.body).not.toMatch(/^storage_deletion_/m);
    });

    it("allows unauthenticated development scrapes when no token is configured", async () => {
        const scrape = await serve({
            scrapeToken: undefined,
            isProduction: false,
            logger: makeLogger(),
        });

        expect((await scrape()).status).toBe(200);
    });

    it("matches web token whitespace handling", async () => {
        const scrape = await serve({
            scrapeToken: "secret",
            isProduction: true,
            logger: makeLogger(),
        });

        expect((await scrape("Bearer  secret  ")).status).toBe(200);
    });

    it("returns 503 and logs a failed registry scrape", async () => {
        vi.spyOn(metricsRegistry, "metrics").mockRejectedValueOnce(new Error("collector failed"));
        const logger = makeLogger();
        const scrape = await serve({ scrapeToken: "secret", isProduction: true, logger });

        const response = await scrape("Bearer secret");

        expect(response.status).toBe(503);
        expect(JSON.parse(response.body)).toEqual({ message: "Metrics not available" });
        expect(logger.error).toHaveBeenCalledWith(
            { error: "Error: collector failed" },
            "Metrics endpoint error"
        );
    });
});

describe("best-effort storage deletion backlog refresh", () => {
    it("logs a query failure without rejecting the deletion attempt", async () => {
        const error = new Error("database unavailable");
        const execute = vi.fn().mockRejectedValueOnce(error);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(
            refreshStorageDeletionBacklog({ execute } as unknown as Executor)
        ).resolves.toBeUndefined();
        expect(log).toHaveBeenCalledWith(
            "[storage-deletion] backlog metrics refresh failed:",
            error
        );
    });

    it.each(["pending", "oldest"])("logs a %s gauge failure without rejecting", async gauge => {
        const error = new Error("gauge unavailable");
        vi.spyOn(
            gauge === "pending" ? storageDeletionPendingItems : storageDeletionOldestPendingAge,
            "set"
        ).mockImplementationOnce(() => {
            throw error;
        });
        const execute = vi.fn().mockResolvedValue([{ pending: 7, oldest: 31 }]);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(
            refreshStorageDeletionBacklog({ execute } as unknown as Executor)
        ).resolves.toBeUndefined();
        expect(log).toHaveBeenCalledWith(
            "[storage-deletion] backlog metrics refresh failed:",
            error
        );
    });
});
