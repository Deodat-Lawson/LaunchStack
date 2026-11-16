import type { RequestListener } from "node:http";

import type { LoggerPort } from "@launchstack/runtime";
import { getMetricsSnapshot, metricsRegistry } from "~/server/metrics/registry";
import { bearerMatches } from "~/server/metrics/scrape-auth";

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
