import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { relative, resolve } from "node:path";

import { eq } from "drizzle-orm";
import {
    company,
    document,
    documentContextChunks,
    documentVersions,
    founderWeeklyReviewDispatches,
} from "@launchstack/core/db/schema";
import { FounderWeeklyReviewRepository } from "@launchstack/features/founder-weekly-review";

import { createFounderWeeklyReviewDispatchService } from "~/server/founder-weekly-review/dispatch-service";
import { renderFounderWeeklyReviewMarkdown } from "~/server/founder-weekly-review/markdown";

const require = createRequire(import.meta.url);
const { createFounderWeeklyReviewTestDatabase } = require("../__tests__/founderWeeklyReview/testDb") as typeof import("../__tests__/founderWeeklyReview/testDb");
const fixturePath = resolve(process.cwd(), "test-fixtures/founder-weekly-review/realistic-company/seed.json");
const STARTUP_TIMEOUT_MS = 45_000;
const SOCKET_RELEASE_WAIT_MS = 1_500;
const STARTUP_SMOKE_ONLY = process.env.FWR_TRANSPORT_STARTUP_SMOKE_ONLY === "1";
const VERBOSE_CHILD_LOGS = process.env.FWR_TRANSPORT_VERBOSE_LOGS === "1";
const RECENT_DIAGNOSTIC_LIMIT = 160;
const SHUTDOWN_DRAIN_CAP_MS = 5_000;
const CALLBACK_QUIET_MS = 1_000;

type Fixture = {
    reportingPeriod: { start: string; end: string };
    workspaceTimezone: string;
    founderContext: string;
    documents: Array<{
        title: string;
        category: string;
        changelog: string;
        timestamp: string;
        chunks?: string[];
    }>;
};

interface ManagedChild {
    name: "next" | "inngest" | string;
    process: ChildProcess;
}

interface ShutdownDrainState {
    terminalStatus: "draft" | "failed" | null;
    finalDiagnosticsCaptured: boolean;
    cleanupStarted: boolean;
    callbackDrained: boolean;
    lastCallbackActivityAt: number;
    functionFinishedAfterTerminal: boolean;
    knownMissingBodyDuringShutdown: boolean;
}

function digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function sleep(ms: number) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function lifecycleTimeoutMs(): number {
    const raw = process.env.FWR_TRANSPORT_TIMEOUT_MS;
    if (!raw) return 720_000;
    if (!/^\d+$/.test(raw)) {
        throw new Error("FWR_TRANSPORT_TIMEOUT_MS must be a positive safe integer.");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("FWR_TRANSPORT_TIMEOUT_MS must be a positive safe integer.");
    }
    return value;
}

async function allocateLoopbackPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
            server.off("error", rejectListen);
            resolveListen();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Unable to allocate a loopback TCP port.");
    }
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    return address.port;
}

async function canConnect(port: number, host: string): Promise<boolean> {
    return new Promise((resolveConnect) => {
        const socket = net.createConnection({ host, port });
        const settle = (listening: boolean) => {
            socket.removeAllListeners();
            socket.destroy();
            resolveConnect(listening);
        };
        socket.once("connect", () => settle(true));
        socket.once("error", () => settle(false));
        socket.setTimeout(500, () => settle(false));
    });
}

async function isPortListening(port: number): Promise<boolean> {
    // `next dev -H localhost` may choose IPv6 loopback on Windows. Check both
    // loopback families so stale listeners are never mistaken for a free port.
    return (await canConnect(port, "127.0.0.1")) || await canConnect(port, "::1");
}

async function assertPortClosed(port: number, label: string): Promise<void> {
    if (await isPortListening(port)) {
        throw new Error(`${label} port ${port} is already listening; refusing to attach to an existing process.`);
    }
}

function childIsAlive(child: ManagedChild | undefined): boolean {
    return Boolean(child && child.process.exitCode === null && child.process.signalCode === null);
}

function boundedLogs(logs: string[]): string {
    return logs.slice(-100).join("").slice(-8_000);
}

function appendRecentDiagnostic(logs: string[], line: string): void {
    logs.push(line);
    if (logs.length > RECENT_DIAGNOSTIC_LIMIT) logs.splice(0, logs.length - RECENT_DIAGNOSTIC_LIMIT);
}

function isInngestDevUiNoise(line: string): boolean {
    try {
        const parsed = JSON.parse(line) as { level?: unknown; event?: unknown; event_name?: unknown };
        return parsed.level === "INFO" && (parsed.event === "cli/dev_ui.loaded" || parsed.event_name === "cli/dev_ui.loaded");
    } catch {
        return false;
    }
}

function isUsefulDiagnostic(name: string, line: string): boolean {
    return /warn|error|fail|exception|stack|retry|founder-weekly-review|claim-evidence|collect-evidence|persist-evidence|\bclaim\b|\bgenerate\b|\bpersist\b|database|relation|column|non-2\d\d|PUT \/api\/inngest 200/i.test(line);
}

function isTerminalNoise(name: string, line: string): boolean {
    if (name === "inngest") return isInngestDevUiNoise(line);
    // Keep registration failures and non-2xx callbacks visible, but omit the
    // steady-state successful callback poll noise from the terminal.
    return /^(GET|PUT) \/api\/inngest.*\s2\d\d\s/i.test(line)
        || /^responseBody:/i.test(line);
}

function isKnownShutdownMissingBody(
    name: "next" | "inngest",
    line: string,
    state: ShutdownDrainState
): boolean {
    return name === "next"
        && line.includes("[Inngest] error - Missing body when executing, possibly due to missing request body middleware")
        && state.terminalStatus !== null
        && state.finalDiagnosticsCaptured
        && state.cleanupStarted
        && state.callbackDrained;
}

function printRecentDiagnostics(name: "next" | "inngest", logs: string[]): void {
    console.log(`===== RECENT ${name.toUpperCase()} DIAGNOSTICS =====`);
    for (const line of logs) console.log(line);
    console.log(`===== END ${name.toUpperCase()} DIAGNOSTICS =====`);
}

async function closeLogStream(stream: WriteStream): Promise<void> {
    await new Promise<void>((resolveClose) => stream.end(resolveClose));
}

function startManagedChild(
    managedChildren: ManagedChild[],
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    logs: string[],
    rawLog: WriteStream,
    name: "next" | "inngest",
    shutdownDrain: ShutdownDrainState
): ManagedChild {
    // pnpm.cmd requires cmd.exe on Windows. taskkill /T in cleanup targets this shell
    // PID and its pnpm/Node descendants as one scoped process tree.
    const child = spawn(command, args, {
        cwd,
        env,
        shell: process.platform === "win32",
        windowsHide: true,
    });
    const managed: ManagedChild = { name, process: child };
    managedChildren.push(managed);
    const emit = (stream: "stdout" | "stderr", data: Buffer) => {
        const output = data.toString();
        rawLog.write(output);
        for (const line of output.split(/\r?\n/)) {
            if (!line.trim()) continue;
            if (name === "next" && /\/api\/inngest/i.test(line)) shutdownDrain.lastCallbackActivityAt = Date.now();
            if (name === "inngest" && shutdownDrain.terminalStatus && line.includes("inngest/function.finished")) shutdownDrain.functionFinishedAfterTerminal = true;
            const formatted = `[${name}:${stream}] ${line}`;
            const expectedShutdownNoise = isKnownShutdownMissingBody(name, line, shutdownDrain);
            const suppressedNoise = isTerminalNoise(name, line) || expectedShutdownNoise;
            if (isUsefulDiagnostic(name, line) && !suppressedNoise) appendRecentDiagnostic(logs, formatted);
            if (expectedShutdownNoise) {
                shutdownDrain.knownMissingBodyDuringShutdown = true;
                console.log("[next] known shutdown-only Inngest callback race observed; retained in raw log");
            }
            if (VERBOSE_CHILD_LOGS || !suppressedNoise) console.log(formatted);
        }
    };
    child.stdout?.on("data", (data: Buffer) => emit("stdout", data));
    child.stderr?.on("data", (data: Buffer) => emit("stderr", data));
    child.once("exit", (code, signal) => {
        const line = `[${name}] exited code=${code ?? "null"} signal=${signal ?? "none"}`;
        appendRecentDiagnostic(logs, line);
        console.log(line);
    });
    return managed;
}

async function drainTerminalCallbackActivity(state: ShutdownDrainState): Promise<void> {
    const deadline = Date.now() + SHUTDOWN_DRAIN_CAP_MS;
    console.log(`[cleanup] draining terminal callback activity capMs=${SHUTDOWN_DRAIN_CAP_MS}`);
    while (Date.now() < deadline) {
        const callbackQuiet = Date.now() - state.lastCallbackActivityAt >= CALLBACK_QUIET_MS;
        if (state.functionFinishedAfterTerminal && callbackQuiet) {
            state.callbackDrained = true;
            console.log("[cleanup] terminal callback drain settled");
            return;
        }
        await sleep(100);
    }
    console.warn(`[cleanup] terminal callback drain cap reached functionFinished=${state.functionFinishedAfterTerminal}`);
}

function terminateProcessTree(child: ManagedChild): void {
    const pid = child.process.pid;
    if (!pid || !childIsAlive(child)) return;
    if (process.platform === "win32") {
        const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (result.error || (result.status !== 0 && childIsAlive(child))) {
            console.warn(`[cleanup] ${child.name} pid=${pid} taskkill did not confirm termination (already exited is non-fatal)`);
        }
        return;
    }
    child.process.kill("SIGTERM");
}

async function waitForChildExit(child: ManagedChild): Promise<void> {
    if (!childIsAlive(child)) return;
    await Promise.race([
        new Promise<void>((resolveExit) => child.process.once("exit", () => resolveExit())),
        sleep(5_000),
    ]);
}

function owningPid(port: number): string | undefined {
    if (process.platform !== "win32") return undefined;
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    const match = result.stdout?.split(/\r?\n/).find((line) => new RegExp(`127\\.0\\.0\\.1:${port}\\s+.*LISTENING`, "i").test(line));
    return match?.trim().split(/\s+/).at(-1);
}

async function waitForCallback(
    callbackUrl: string,
    managedChildren: ManagedChild[],
    logs: string[],
    shouldAbort: () => boolean
): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (shouldAbort()) throw new Error("Startup interrupted before callback readiness.");
        const next = managedChildren.find((child) => child.name === "next");
        if (!childIsAlive(next)) throw new Error(`Next exited before callback readiness: ${boundedLogs(logs)}`);
        try {
            const response = await fetch(callbackUrl);
            const registration = await response.text();
            const functionsInGetResponse = registration.includes("founder-weekly-review-dispatcher") && registration.includes("founder-weekly-review-generation");
            // The dev CLI performs the authoritative registration with PUT. A
            // bare GET is still required to respond successfully, but its body
            // is protocol-dependent and does not always echo function IDs.
            const functionsRegisteredByCli = logs.some((line) => line.includes("PUT /api/inngest 200"));
            if (response.ok && (functionsInGetResponse || functionsRegisteredByCli)) {
                console.log(`[harness] callback ready url=${callbackUrl}; Founder Weekly Review functions registered=${functionsInGetResponse ? "GET" : "CLI PUT"}`);
                return;
            }
        } catch {
            // Next is still booting; child liveness is checked every iteration.
        }
        await sleep(500);
    }
    throw new Error(`Timed out waiting for registered callback ${callbackUrl}: ${boundedLogs(logs)}`);
}

async function waitForHttp(url: string, child: ManagedChild, logs: string[], shouldAbort: () => boolean): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (shouldAbort()) throw new Error("Startup interrupted before Inngest readiness.");
        if (!childIsAlive(child)) throw new Error(`Inngest exited before readiness: ${boundedLogs(logs)}`);
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            // Inngest is still booting.
        }
        await sleep(500);
    }
    throw new Error(`Timed out waiting for ${url}: ${boundedLogs(logs)}`);
}

async function waitForPort(port: number, child: ManagedChild, logs: string[], shouldAbort: () => boolean): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (shouldAbort()) throw new Error("Startup interrupted before Next was listening.");
        if (!childIsAlive(child)) throw new Error(`Next exited before listening: ${boundedLogs(logs)}`);
        if (await isPortListening(port)) return;
        await sleep(250);
    }
    throw new Error(`Timed out waiting for Next port ${port}: ${boundedLogs(logs)}`);
}

function createCleanupController(
    managedChildren: ManagedChild[],
    nextPort: number,
    inngestPort: number,
    shutdownDrain: ShutdownDrainState
): () => Promise<void> {
    let cleanupPromise: Promise<void> | undefined;
    return () => cleanupPromise ??= (async () => {
        shutdownDrain.cleanupStarted = true;
        console.log("[cleanup] stopping managed child process trees");
        for (const child of [...managedChildren].reverse()) {
            console.log(`[cleanup] stopping ${child.name} pid=${child.process.pid ?? "unknown"}`);
            terminateProcessTree(child);
            await waitForChildExit(child);
        }
        await sleep(SOCKET_RELEASE_WAIT_MS);
        let portsClosed = true;
        for (const [name, port] of [["next", nextPort], ["inngest", inngestPort]] as const) {
            if (await isPortListening(port)) {
                portsClosed = false;
                const child = managedChildren.find((candidate) => candidate.name === name);
                console.warn(`[cleanup] ${name}Port=${port} still listening pid=${owningPid(port) ?? "unknown"} childAlive=${childIsAlive(child)}`);
            } else {
                console.log(`[cleanup] ${name}Port=closed`);
            }
        }
        if (shutdownDrain.knownMissingBodyDuringShutdown && portsClosed) {
            console.log("[cleanup] known Missing body message classified as shutdown-only after terminal callback drain and port closure");
        }
    })();
}

async function main(): Promise<void> {
    if (process.env.SYNTHETIC_FWR_LOCAL !== "1" || process.env.NODE_ENV === "production") {
        throw new Error("Refusing transport E2E outside explicit local mode.");
    }
    const localUrl = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    if (!/^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(localUrl)) {
        throw new Error("Refusing non-local database.");
    }
    if (!STARTUP_SMOKE_ONLY && !process.env.MOONSHOT_API_KEY?.trim()) {
        throw new Error("MOONSHOT_API_KEY is required for the real callback generation.");
    }

    const testDb = await createFounderWeeklyReviewTestDatabase();
    const managedChildren: ManagedChild[] = [];
    const nextLogs: string[] = [];
    const inngestLogs: string[] = [];
    const artifactDirectory = resolve(process.cwd(), ".artifacts/founder-weekly-review");
    await mkdir(artifactDirectory, { recursive: true });
    const nextLogPath = resolve(artifactDirectory, "transport-next.log");
    const inngestLogPath = resolve(artifactDirectory, "transport-inngest.log");
    const nextRawLog = createWriteStream(nextLogPath, { flags: "w" });
    const inngestRawLog = createWriteStream(inngestLogPath, { flags: "w" });
    const nextPort = await allocateLoopbackPort();
    let inngestPort = await allocateLoopbackPort();
    while (inngestPort === nextPort) inngestPort = await allocateLoopbackPort();
    const shutdownDrain: ShutdownDrainState = {
        terminalStatus: null,
        finalDiagnosticsCaptured: false,
        cleanupStarted: false,
        callbackDrained: false,
        lastCallbackActivityAt: Date.now(),
        functionFinishedAfterTerminal: false,
        knownMissingBodyDuringShutdown: false,
    };
    const cleanup = createCleanupController(managedChildren, nextPort, inngestPort, shutdownDrain);
    let shutdownRequested = false;
    const requestShutdown = (reason: string) => {
        shutdownRequested = true;
        console.warn(`[cleanup] ${reason} received`);
        void cleanup().catch((error: unknown) => console.warn(`[cleanup] ${String(error)}`));
    };
    const onSigint = () => requestShutdown("SIGINT");
    const onSigterm = () => requestShutdown("SIGTERM");
    const onUncaughtException = (error: Error) => {
        console.error(`[cleanup] uncaughtException: ${error.message}`);
        process.exitCode = 1;
        requestShutdown("uncaughtException");
    };
    const onUnhandledRejection = (reason: unknown) => {
        console.error(`[cleanup] unhandledRejection: ${String(reason)}`);
        process.exitCode = 1;
        requestShutdown("unhandledRejection");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("uncaughtException", onUncaughtException);
    process.once("unhandledRejection", onUnhandledRejection);

    try {
        const schemaUrl = new URL(localUrl);
        schemaUrl.searchParams.set("options", `-c search_path=${testDb.schemaName},public`);
        // The current Next/Inngest adapter normalizes its callback host to
        // localhost. Explicitly bind there (loopback-only) so the adapter and
        // CLI address the same listener; allocation remains 127.0.0.1-only.
        const callbackUrl = `http://localhost:${nextPort}/api/inngest`;
        const inngestUrl = `http://127.0.0.1:${inngestPort}`;
        const runtimeEnv: NodeJS.ProcessEnv = {
            ...process.env,
            DATABASE_URL: schemaUrl.toString(),
            LAUNCHSTACK_TEST_DATABASE_URL: schemaUrl.toString(),
            // The current Inngest SDK treats a URL-valued INNGEST_DEV as the
            // explicit local dev-server target. INNGEST_BASE_URL configures the
            // API/event base and is not a replacement for this transport URL.
            INNGEST_DEV: inngestUrl,
            INNGEST_EVENT_KEY: "local-transport",
        };
        console.log(`[harness] database host=${schemaUrl.hostname} port=${schemaUrl.port || "5432"} schema=${testDb.schemaName}`);
        console.log(`[harness] selected nextPort=${nextPort} inngestPort=${inngestPort}`);
        console.log(`[harness] verbose child logs: ${VERBOSE_CHILD_LOGS ? "enabled" : "disabled"}`);
        console.log(`[harness] Next log: ${relative(process.cwd(), nextLogPath)}`);
        console.log(`[harness] Inngest log: ${relative(process.cwd(), inngestLogPath)}`);
        await assertPortClosed(nextPort, "Next");
        await assertPortClosed(inngestPort, "Inngest");
        const next = startManagedChild(managedChildren, "pnpm.cmd", ["exec", "next", "dev", "--turbo", "-H", "localhost", "-p", String(nextPort)], process.cwd(), runtimeEnv, nextLogs, nextRawLog, "next", shutdownDrain);
        console.log(`[next] expected schema=${testDb.schemaName}`);
        // Inngest's serve handler proxies its registration response through the
        // dev server. Before that server exists, a GET can reset even though the
        // current child owns and is listening on the allocated callback port.
        await waitForPort(nextPort, next, nextLogs, () => shutdownRequested);
        await assertPortClosed(inngestPort, "Inngest");
        const inngest = startManagedChild(managedChildren, "pnpm.cmd", ["dlx", "inngest-cli@latest", "dev", "--no-discovery", "-u", callbackUrl, "--port", String(inngestPort)], process.cwd(), runtimeEnv, inngestLogs, inngestRawLog, "inngest", shutdownDrain);
        await waitForHttp(inngestUrl, inngest, inngestLogs, () => shutdownRequested);
        await waitForCallback(callbackUrl, managedChildren, nextLogs, () => shutdownRequested);
        console.log(`[harness] Inngest ready url=${inngestUrl} callback=${callbackUrl}`);
        if (STARTUP_SMOKE_ONLY) {
            console.log("[harness] startup/cleanup smoke completed; no data seeded, event dispatched, or provider called");
            return;
        }

        const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
        const [target] = await testDb.db.insert(company).values({ name: "Northstar Analytics", numberOfEmployees: "24" }).returning();
        const [other] = await testDb.db.insert(company).values({ name: "Other Company", numberOfEmployees: "4" }).returning();
        for (const entry of fixture.documents) {
            const [doc] = await testDb.db.insert(document).values({ companyId: BigInt(target!.id), url: `local://${entry.title}`, category: entry.category, title: entry.title }).returning();
            const [version] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 1, url: `local://${entry.title}/v1`, mimeType: "text/plain", uploadedBy: "seed", changelog: entry.changelog, createdAt: new Date(entry.timestamp) }).returning();
            for (const [index, content] of (entry.chunks ?? []).entries()) {
                await testDb.db.insert(documentContextChunks).values({ documentId: BigInt(doc!.id), versionId: BigInt(version!.id), content, tokenCount: content.split(/\s+/).length, charCount: content.length, pageNumber: index + 1 });
            }
        }
        for (const [companyId, title, timestamp] of [[BigInt(target!.id), "Outside period", "2026-03-01T00:00:00.000Z"], [BigInt(other!.id), "Other company control", "2026-02-21T00:00:00.000Z"]] as const) {
            const [doc] = await testDb.db.insert(document).values({ companyId, url: `local://${title}`, category: "Product", title }).returning();
            await testDb.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 1, url: `local://${title}/v1`, mimeType: "text/plain", uploadedBy: "seed", changelog: title, createdAt: new Date(timestamp) });
        }
        const [seededDocuments, seededVersions, seededChunks] = await Promise.all([
            testDb.db.select().from(document),
            testDb.db.select().from(documentVersions),
            testDb.db.select().from(documentContextChunks),
        ]);
        console.log(`[harness] fixture counts companies=2 documents=${seededDocuments.length} versions=${seededVersions.length} contextChunks=${seededChunks.length}`);
        const actor = { externalUserId: "realistic-owner", internalUserId: 1n, companyId: BigInt(target!.id), role: "owner" as const };
        const created = await createFounderWeeklyReviewDispatchService(testDb.db).createRunWithDispatch({ actor, requestKey: `transport-${randomUUID()}`, reportingPeriod: fixture.reportingPeriod, collectionInput: { workspaceTimezone: fixture.workspaceTimezone, founderContext: fixture.founderContext, actorExternalUserId: actor.externalUserId } });
        if (created.run.status !== "queued" || created.run.evidenceSnapshot) throw new Error("Initial queued-without-snapshot invariant failed.");
        const initialDispatches = await testDb.db.select().from(founderWeeklyReviewDispatches).where(eq(founderWeeklyReviewDispatches.runId, created.run.id));
        if (initialDispatches.length !== 1) throw new Error("Expected exactly one initial outbox dispatch.");
        process.env.INNGEST_DEV = inngestUrl;
        process.env.INNGEST_EVENT_KEY = "local-transport";
        const { inngest: client } = await import("~/server/inngest/client");
        const requested = await client.send({ name: "founder-weekly-review/dispatch.requested", data: {} });
        console.log(`[harness] dispatch event sent at=${new Date().toISOString()}`);
        const repository = new FounderWeeklyReviewRepository(testDb.db);
        const deadline = Date.now() + lifecycleTimeoutMs();
        const startedAt = Date.now();
        let heartbeatAt = 0;
        const seen: string[] = ["queued without snapshot"];
        let previousState = seen[0]!;
        let final: Awaited<ReturnType<FounderWeeklyReviewRepository["getByCompanyAndRunId"]>> | null = null;
        while (Date.now() < deadline) {
            if (shutdownRequested) throw new Error("Transport run interrupted during lifecycle polling.");
            if (!childIsAlive(next) || !childIsAlive(inngest)) {
                throw new Error("A managed child exited before the Founder Weekly Review reached a terminal state.");
            }
            const current = await repository.getByCompanyAndRunId(actor.companyId, created.run.id);
            const currentDispatch = (await testDb.db.select().from(founderWeeklyReviewDispatches).where(eq(founderWeeklyReviewDispatches.id, created.dispatch.id)))[0];
            if (current) {
                const state = `${current.status}${current.evidenceSnapshot ? " with snapshot" : " without snapshot"}`;
                if (state !== previousState) {
                    previousState = state;
                    seen.push(state);
                    console.log(`[harness] lifecycle ${state} at=${new Date().toISOString()}`);
                }
                if (Date.now() - heartbeatAt >= 10_000) {
                    heartbeatAt = Date.now();
                    console.log(`[harness +${Math.floor((Date.now() - startedAt) / 1000)}s] nextAlive=${childIsAlive(next)} inngestAlive=${childIsAlive(inngest)} callbackReady=true runStatus=${current.status} snapshot=${current.evidenceSnapshot ? "present" : "absent"} dispatchStatus=${currentDispatch?.status ?? "unknown"} collectionClaim=${current.collectionClaimId ? "present" : "absent"} generationClaim=${current.generationClaimId ? "present" : "absent"}`);
                }
                if (current.status === "draft") {
                    final = current;
                    shutdownDrain.terminalStatus = "draft";
                    console.log("[harness] terminal status=draft observed; stopping lifecycle polling and starting cleanup");
                    break;
                }
                if (current.status === "failed") {
                    console.error(JSON.stringify({
                        runId: current.id,
                        status: current.status,
                        failureCode: current.errorCode,
                        failureMessage: current.errorMessage?.slice(0, 1_024) ?? null,
                        snapshot: current.evidenceSnapshot ? "present" : "absent",
                        collectionClaim: current.collectionClaimId ? "present" : "absent",
                        collectionStartedAt: current.collectionStartedAt?.toISOString() ?? null,
                        evidenceCollectedAt: current.evidenceCollectedAt?.toISOString() ?? null,
                        generationClaim: current.generationClaimId ? "present" : "absent",
                        retryCount: current.retryCount,
                        dispatchStatus: currentDispatch?.status ?? null,
                        dispatchAttempts: currentDispatch?.attemptCount ?? null,
                        lastLifecycleTransition: current.updatedAt?.toISOString() ?? current.createdAt.toISOString(),
                    }));
                    shutdownDrain.terminalStatus = "failed";
                    shutdownDrain.finalDiagnosticsCaptured = true;
                    console.log("[harness] terminal status=failed observed; stopping lifecycle polling and starting cleanup");
                    throw new Error(`Founder Weekly Review run ${current.id} failed before draft persistence.`);
                }
            }
            await sleep(500);
        }
        if (!final?.reviewPayload || !final.evidenceSnapshot) throw new Error("Timed out before persisted draft read-back.");
        const dispatch = (await testDb.db.select().from(founderWeeklyReviewDispatches).where(eq(founderWeeklyReviewDispatches.id, created.dispatch.id)))[0];
        const rendered = renderFounderWeeklyReviewMarkdown(final);
        const directory = resolve(process.cwd(), ".artifacts/founder-weekly-review");
        await mkdir(directory, { recursive: true });
        const markdownPath = resolve(directory, `${final.id}-transport.md`);
        await writeFile(markdownPath, rendered, "utf8");
        if (process.env.FWR_PRINT_REPORT === "1") {
            console.log("===== FOUNDER WEEKLY REVIEW =====");
            console.log(rendered);
            console.log("===== END FOUNDER WEEKLY REVIEW =====");
        }
        const generationEventKeys = ["runId", "companyId", "generationJobId", "generationClaimId"];
        const forbiddenEventKeys = ["evidenceSnapshot", "founderContext", "documentContent", "customerFeedback", "prompt", "reviewPayload", "providerResponse", "databaseUrl", "credentials", "token"];
        console.log(JSON.stringify({ runId: final.id, lifecycle: seen, dispatch: { initialStatus: initialDispatches[0]!.status, finalStatus: dispatch?.status, attempts: dispatch?.attemptCount }, ingressEventIds: requested.ids, callbackUrl, functionId: "founder-weekly-review-generation", transportEvent: { name: "founder-weekly-review/generation.requested", keys: generationEventKeys, companyIdSerializedAsString: true, forbiddenKeysAbsent: forbiddenEventKeys.every((key) => !generationEventKeys.includes(key)) }, steps: ["claim-evidence", "collect-evidence", "persist-evidence", "claim", "generate", "persist"], evidenceCounts: Object.fromEntries(["document_change", "customer_feedback", "founder_context"].map((type) => [type, final!.evidenceSnapshot!.items.filter((item) => item.sourceType === type).length])), snapshotDigest: digest(final.evidenceSnapshot), retryCount: final.retryCount, generationAttempt: final.generationAttempt, provider: final.modelMetadata?.provider, model: final.modelMetadata?.model, validation: { canonicalSchema: true, citations: true, sourceSemantics: true }, markdownPath, terminalEqualsExport: (await readFile(markdownPath, "utf8")) === rendered, devLogsMentionFunction: inngestLogs.join("").includes("founder-weekly-review-generation") }));
        shutdownDrain.finalDiagnosticsCaptured = true;
    } catch (error) {
        printRecentDiagnostics("next", nextLogs);
        printRecentDiagnostics("inngest", inngestLogs);
        throw error;
    } finally {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        process.off("uncaughtException", onUncaughtException);
        process.off("unhandledRejection", onUnhandledRejection);
        if (shutdownDrain.terminalStatus && shutdownDrain.finalDiagnosticsCaptured) {
            await drainTerminalCallbackActivity(shutdownDrain);
        }
        await cleanup();
        await closeLogStream(nextRawLog);
        await closeLogStream(inngestRawLog);
        // testDb.close closes client connections and drops the schema only after callback processes and ports are handled.
        await testDb.close();
    }
}

await main();
