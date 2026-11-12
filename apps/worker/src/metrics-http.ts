import { timingSafeEqual } from "node:crypto";
import type { RequestListener } from "node:http";

import type { LoggerPort } from "@launchstack/runtime";
import { getMetricsSnapshot, metricsRegistry } from "~/server/metrics/registry";

function bearerMatches(header: string | undefined, token: string): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = header.slice("Bearer ".length).trim();
    if (!provided || provided.length !== token.length) return false;
    try {
        return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    } catch {
        return false;
    }
}

export function createMetricsHandler(options: {
    scrapeToken: string | undefined;
    isProduction: boolean;
    logger: LoggerPort;
}): RequestListener {
    let warnedMissingScrapeToken = false;
    return (req, res) => {
        const { scrapeToken, isProduction, logger } = options;
        if (!scrapeToken && isProduction) {
            if (!warnedMissingScrapeToken) {
                warnedMissingScrapeToken = true;
                logger.error(
                    {},
                    "[metrics] METRICS_SCRAPE_TOKEN is not set — GET /metrics is returning 503 in production. " +
                        "Set it (and send `Authorization: Bearer <token>` from your scraper) to restore metrics collection."
                );
            }
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Metrics scrape token not configured" }));
            return;
        }
        if (scrapeToken && !bearerMatches(req.headers.authorization, scrapeToken)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Unauthorized" }));
            return;
        }

        void getMetricsSnapshot()
            .then(body => {
                res.writeHead(200, { "Content-Type": metricsRegistry.contentType });
                res.end(body);
            })
            .catch((error: unknown) => {
                logger.error({ error: String(error) }, "Metrics endpoint error");
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: "Metrics not available" }));
            });
    };
}
