/**
 * Record-and-replay HTTP for the company-search experiments.
 *
 * Every experiment talks to the outside world through `recorder.fetchImpl`.
 * In `record` mode a request that was never made is sent once (rate-limited
 * per host, with a generic User-Agent) and written to the cache; in `replay`
 * mode nothing leaves the machine and an unrecorded request is an error. So a
 * policy can be re-run with any number of seeds for free, and two runs see
 * exactly the same world.
 *
 * Failures are part of the world: a 404, a timeout or a refused connection
 * is recorded and replays as the same failure.
 *
 * The cache holds public register records and page text that can include
 * contact details, so it is never committed (see ../.gitignore).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

export type RecorderMode = "record" | "replay";

export interface RecordedExchange {
    url: string;
    method: string;
    /** 0 when the request threw before a response arrived. */
    status: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
    error?: string;
    ms: number;
    at: string;
}

export interface RecorderOptions {
    /** Cache directory; defaults to COMPANY_SEARCH_BENCH_CACHE or ../.cache. */
    dir?: string;
    /** Defaults to COMPANY_SEARCH_BENCH_MODE, else "replay". */
    mode?: RecorderMode;
    userAgent?: string;
    /** Minimum gap between two live requests to one host (default 1,000 ms). */
    minDelayMs?: number;
    /** Per-host overrides of `minDelayMs`. */
    hostDelayMs?: Record<string, number>;
    /** Whole-request timeout for live requests (default 20 s). */
    timeoutMs?: number;
    /** Response bodies are cut here (default 1.5 MB). */
    maxBodyBytes?: number;
    /** Namespace inside the cache, so experiments can be cleared separately. */
    namespace?: string;
}

/** Generic on purpose: the experiments never send the product's name out. */
export const BENCH_USER_AGENT = "company-search-bench/0.1 (research; low volume)";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CACHE_DIR =
    process.env.COMPANY_SEARCH_BENCH_CACHE ?? path.resolve(HERE, "..", ".cache");

export function defaultMode(): RecorderMode {
    return process.env.COMPANY_SEARCH_BENCH_MODE === "record" ? "record" : "replay";
}

const KEPT_HEADERS = ["content-type", "location", "retry-after"];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class NotRecordedError extends Error {
    constructor(method: string, url: string) {
        super(`Not recorded (replay mode): ${method} ${url}`);
        this.name = "NotRecordedError";
    }
}

export class Recorder {
    readonly dir: string;
    readonly mode: RecorderMode;
    /** Requests that went out on the network in this process. */
    live = 0;
    /** Requests answered from the cache in this process. */
    replayed = 0;
    private readonly options: Required<
        Pick<RecorderOptions, "userAgent" | "minDelayMs" | "timeoutMs" | "maxBodyBytes">
    > &
        Pick<RecorderOptions, "hostDelayMs">;
    /** Tail of each host's queue, so live requests to a host never overlap. */
    private readonly hostQueue = new Map<string, Promise<void>>();
    private readonly lastLiveAt = new Map<string, number>();

    constructor(options: RecorderOptions = {}) {
        this.dir = path.join(options.dir ?? DEFAULT_CACHE_DIR, options.namespace ?? "default");
        this.mode = options.mode ?? defaultMode();
        this.options = {
            userAgent: options.userAgent ?? BENCH_USER_AGENT,
            minDelayMs: options.minDelayMs ?? 1_000,
            timeoutMs: options.timeoutMs ?? 20_000,
            maxBodyBytes: options.maxBodyBytes ?? 1_500_000,
            hostDelayMs: options.hostDelayMs,
        };
    }

    private fileFor(method: string, url: string, body: string): string {
        let host = "unknown";
        try {
            host = new URL(url).hostname;
        } catch {
            /* keep "unknown" */
        }
        const hash = createHash("sha1").update(`${method} ${url}\n${body}`).digest("hex");
        return path.join(this.dir, host, `${hash}.json.gz`);
    }

    /** The recorded exchange for a request, or null. */
    lookup(url: string, method = "GET", body = ""): RecordedExchange | null {
        const file = this.fileFor(method, url, body);
        if (!existsSync(file)) return null;
        return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as RecordedExchange;
    }

    private store(exchange: RecordedExchange, body: string): void {
        const file = this.fileFor(exchange.method, exchange.url, body);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(exchange), "utf8")));
    }

    private async live_(
        url: string,
        method: string,
        body: string,
        init: RequestInit | undefined
    ): Promise<RecordedExchange> {
        const host = new URL(url).hostname;
        const gap = this.options.hostDelayMs?.[host] ?? this.options.minDelayMs;
        const previous = this.hostQueue.get(host) ?? Promise.resolve();
        let release!: () => void;
        this.hostQueue.set(
            host,
            new Promise<void>(resolve => {
                release = resolve;
            })
        );
        await previous;
        try {
            const wait = (this.lastLiveAt.get(host) ?? 0) + gap - Date.now();
            if (wait > 0) await sleep(wait);
            const started = Date.now();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
            const headers = new Headers(init?.headers);
            headers.set("User-Agent", this.options.userAgent);
            let exchange: RecordedExchange;
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: method === "GET" || method === "HEAD" ? undefined : body,
                    redirect: init?.redirect ?? "follow",
                    signal: controller.signal,
                });
                const buffer = Buffer.from(await response.arrayBuffer());
                const truncated = buffer.byteLength > this.options.maxBodyBytes;
                const kept: Record<string, string> = {};
                for (const name of KEPT_HEADERS) {
                    const value = response.headers.get(name);
                    if (value) kept[name] = value;
                }
                exchange = {
                    url,
                    method,
                    status: response.status,
                    headers: kept,
                    body: new TextDecoder("utf-8", { fatal: false }).decode(
                        truncated ? buffer.subarray(0, this.options.maxBodyBytes) : buffer
                    ),
                    truncated,
                    ms: Date.now() - started,
                    at: new Date().toISOString(),
                };
            } catch (error) {
                exchange = {
                    url,
                    method,
                    status: 0,
                    headers: {},
                    body: "",
                    truncated: false,
                    error: error instanceof Error ? error.message : String(error),
                    ms: Date.now() - started,
                    at: new Date().toISOString(),
                };
            } finally {
                clearTimeout(timer);
            }
            this.lastLiveAt.set(host, Date.now());
            this.live += 1;
            this.store(exchange, body);
            return exchange;
        } finally {
            release();
        }
    }

    /** The exchange for a request: from the cache, or live when recording. */
    async exchange(url: string, init?: RequestInit): Promise<RecordedExchange> {
        const method = (init?.method ?? "GET").toUpperCase();
        const body =
            init?.body === undefined || init.body === null
                ? ""
                : typeof init.body === "string"
                  ? init.body
                  : init.body instanceof URLSearchParams
                    ? init.body.toString()
                    : String(init.body as unknown);
        const cached = this.lookup(url, method, body);
        if (cached) {
            this.replayed += 1;
            return cached;
        }
        if (this.mode === "replay") throw new NotRecordedError(method, url);
        return this.live_(url, method, body, init);
    }

    /** Drop-in `fetch`: the production clients accept this as `fetchImpl`. */
    readonly fetchImpl: typeof fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const exchange = await this.exchange(url, init);
        if (exchange.status === 0) throw new Error(exchange.error ?? "request failed");
        const nullBody = exchange.status === 204 || exchange.status === 304;
        return new Response(nullBody ? null : exchange.body, {
            status: exchange.status,
            headers: exchange.headers,
        });
    };

    /** GET a JSON document; throws on a non-2xx status. */
    async getJson<T>(url: string): Promise<T> {
        const exchange = await this.exchange(url, { headers: { Accept: "application/json" } });
        if (exchange.status === 0) throw new Error(exchange.error ?? "request failed");
        if (exchange.status < 200 || exchange.status >= 300)
            throw new Error(`${new URL(url).hostname} ${exchange.status}`);
        return JSON.parse(exchange.body) as T;
    }
}
