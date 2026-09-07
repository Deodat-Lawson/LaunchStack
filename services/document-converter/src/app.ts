/**
 * HTTP surface of services/document-converter (ADR-004).
 *
 * Endpoints:
 *   GET  /health        open (Docker healthcheck)
 *   GET  /readyz        auth; 200 only when docling-serve answered its
 *                       health check recently OR none is configured
 *   POST /route         auth; RouteRequest -> RouteResponse
 *   POST /render-pages  auth; RenderPagesRequest -> RenderPagesResponse
 *   POST /convert       auth; ConvertRequest -> EvidenceDocument
 *
 * All external effects (document fetch, vision, page rendering, docling)
 * are injectable so tests never touch the network.
 */
import { randomUUID } from "node:crypto";

import express, {
    type ErrorRequestHandler,
    type Express,
    type Request,
    type Response as ExpressResponse,
} from "express";
import type { z } from "zod";

import { apiKeyMiddleware } from "./auth.js";
import type { Config } from "./config.js";
import {
    convertRequestSchema,
    renderPagesRequestSchema,
    routeRequestSchema,
    type RenderPagesResponse,
} from "./contracts.js";
import {
    doclingConvertFile,
    doclingHealthCheck,
    resolveUploadFilename,
    type DoclingConvert,
    type DoclingHealth,
} from "./docling.js";
import { ServiceError, errorEnvelope, errorMessage } from "./errors.js";
import { markdownToEvidenceDocument } from "./evidence.js";
import { assertAllowedUrl, fetchDocument, type FetchLike } from "./fetch.js";
import { log } from "./logger.js";
import { renderPdfPages, type PageRenderer } from "./render.js";
import { determineRouting, type RoutingDeps } from "./routing.js";
import { createVisionClassifier, type VisionClassifier } from "./vision.js";

export interface AppDeps {
    fetchImpl?: FetchLike;
    renderPages?: PageRenderer;
    classify?: VisionClassifier;
    doclingConvert?: DoclingConvert;
    doclingHealth?: DoclingHealth;
}

const READY_TTL_MS = 10_000;

function createReadinessTracker(config: Config, doclingHealth: DoclingHealth) {
    let lastOkAt = 0;
    return async (): Promise<{
        ready: boolean;
        docling: "ok" | "not-configured" | "unreachable";
    }> => {
        if (!config.doclingServeUrl) {
            return { ready: true, docling: "not-configured" };
        }
        if (Date.now() - lastOkAt < READY_TTL_MS) {
            return { ready: true, docling: "ok" };
        }
        try {
            if (await doclingHealth(config)) {
                lastOkAt = Date.now();
                return { ready: true, docling: "ok" };
            }
        } catch {
            // fall through — unreachable
        }
        return { ready: false, docling: "unreachable" };
    };
}

function parseBody<S extends z.ZodType<unknown>>(schema: S, body: unknown): z.infer<S> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        const details = parsed.error.issues
            .map(issue => `${issue.path.join(".") || "body"}: ${issue.message}`)
            .join("; ");
        throw new ServiceError(400, "invalid-request", details);
    }
    return parsed.data as z.infer<S>;
}

/** Body-level traceId is honored only when the caller sent no header. */
function adoptBodyTraceId(
    req: Request,
    res: ExpressResponse,
    bodyTraceId: string | undefined
): void {
    if (bodyTraceId && !req.header("x-trace-id") && !res.headersSent) {
        res.locals.traceId = bodyTraceId;
        res.setHeader("X-Trace-Id", bodyTraceId);
    }
}

export function createApp(config: Config, deps: AppDeps = {}): Express {
    const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    const renderPages = deps.renderPages ?? renderPdfPages;
    const classify = deps.classify ?? createVisionClassifier(config, fetchImpl);
    const doclingConvert = deps.doclingConvert ?? doclingConvertFile;
    const doclingHealth = deps.doclingHealth ?? doclingHealthCheck;

    const app = express();
    app.disable("x-powered-by");

    // Trace propagation + request duration logging.
    app.use((req, res, next) => {
        const startedAt = process.hrtime.bigint();
        const traceId = (req.header("x-trace-id") ?? "").trim() || randomUUID();
        res.locals.traceId = traceId;
        res.setHeader("X-Trace-Id", traceId);
        res.on("finish", () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            log("info", "request", {
                traceId: res.locals.traceId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Math.round(durationMs * 1000) / 1000,
            });
        });
        next();
    });

    // Open: Docker healthcheck calls this with no headers.
    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    // Everything below fails closed without the right X-API-Key.
    app.use(apiKeyMiddleware(config));

    // Bounded body size, as before (PDF buffers arrive base64-in-JSON).
    app.use(express.json({ limit: "100mb" }));

    const readiness = createReadinessTracker(config, doclingHealth);
    app.get("/readyz", async (_req, res) => {
        const state = await readiness();
        res.status(state.ready ? 200 : 503).json({
            status: state.ready ? "ready" : "unready",
            docling: state.docling,
        });
    });

    app.post("/route", async (req, res) => {
        const body = parseBody(routeRequestSchema, req.body);
        adoptBodyTraceId(req, res, body.traceId);
        // Reject disallowed URLs before doing ANY work — including the
        // preferred-provider/forceOCR short-circuits inside determineRouting.
        assertAllowedUrl(config, body.documentUrl, "documentUrl");
        const routingDeps: RoutingDeps = {
            fetchDocument: url => fetchDocument(config, fetchImpl, url, "documentUrl"),
            renderPages,
            classify,
        };
        const routeResponse = await determineRouting(config, routingDeps, body);
        res.json(routeResponse);
    });

    app.post("/render-pages", async (req, res) => {
        const body = parseBody(renderPagesRequestSchema, req.body);
        adoptBodyTraceId(req, res, body.traceId);
        const pdf = Buffer.from(body.buffer, "base64");
        // Wire contract uses 0-based indices; pdf2pic pages are 1-based.
        const images = await renderPages(
            pdf,
            body.pageIndices.map(index => index + 1)
        );
        const response: RenderPagesResponse = {
            schemaVersion: 1,
            images: images.map(image => Buffer.from(image).toString("base64")),
        };
        res.json(response);
    });

    app.post("/convert", async (req, res) => {
        const body = parseBody(convertRequestSchema, req.body);
        adoptBodyTraceId(req, res, body.traceId);
        if (!config.doclingServeUrl) {
            throw new ServiceError(
                503,
                "docling-not-configured",
                "DOCLING_SERVE_URL is not configured; /convert is unavailable on this deployment"
            );
        }
        assertAllowedUrl(config, body.url, "url");
        const file = await fetchDocument(config, fetchImpl, body.url, "url");
        const filename = resolveUploadFilename(body);
        const markdown = await doclingConvert(config, file, filename);
        const evidence = markdownToEvidenceDocument(markdown, {
            filename: body.filename,
            mimeType: body.mimeType,
        });
        res.json(evidence);
    });

    // Unknown routes get the typed envelope too.
    app.use((req, res) => {
        res.status(404).json(
            errorEnvelope(
                "not-found",
                `no route for ${req.method} ${req.path}`,
                res.locals.traceId as string | undefined
            )
        );
    });

    const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
        const traceId = res.locals.traceId as string | undefined;
        if (err instanceof ServiceError) {
            log("warn", "request failed", {
                traceId,
                code: err.code,
                status: err.status,
                message: err.message,
            });
            res.status(err.status).json(errorEnvelope(err.code, err.message, traceId));
            return;
        }
        const known = err as { type?: string; status?: number };
        if (known?.type === "entity.too.large") {
            res.status(413).json(
                errorEnvelope(
                    "payload-too-large",
                    "request body exceeds the configured limit",
                    traceId
                )
            );
            return;
        }
        if (err instanceof SyntaxError && known.status === 400) {
            res.status(400).json(
                errorEnvelope("invalid-request", "request body is not valid JSON", traceId)
            );
            return;
        }
        log("error", "unhandled error", {
            traceId,
            message: errorMessage(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        res.status(500).json(errorEnvelope("internal", "internal error", traceId));
    };
    app.use(errorHandler);

    return app;
}
