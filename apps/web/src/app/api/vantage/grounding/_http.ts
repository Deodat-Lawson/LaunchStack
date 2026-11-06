import { NextResponse } from "next/server";
import { configureSecretBox } from "@launchstack/store/crypto";
import { assertM3BudgetDatabase } from "../../../../../../../pipelines/src/vantage/evaluation-live/m3-request-budget";
import { createDb } from "@launchstack/store/client";
import { VantageError } from "@launchstack/pipelines/vantage";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { canUseVantage } from "~/server/vantage/access";
import { CompanyArchitectureHostErrorV0 } from "~/server/vantage/company-architecture";
import { createGroundingService } from "~/server/vantage/grounding-service";
import { createGroundingExecutionResolver } from "~/server/vantage/grounding-execution";
let connection: ReturnType<typeof createDb> | null = null;
export async function groundingSession(request: Request) {
    let url: URL;
    try {
        url = new URL(process.env.DATABASE_URL ?? "");
    } catch {
        return null;
    }
    if (
        process.env.VANTAGE_GROUNDING_M3_ENABLED !== "true" ||
        process.env.NODE_ENV === "production" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== "55448" ||
        url.username !== "vantage_grounding_m3" ||
        url.pathname !== "/vantage_grounding_m3_20261106" ||
        process.env.VANTAGE_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
        new URL(request.url).origin !== "http://localhost:3188"
    )
        return null;
    if (
        !["GET", "HEAD"].includes(request.method) &&
        request.headers.get("origin") !== "http://localhost:3188"
    )
        throw new ContextPortErrorV0("Cross-origin mutation denied.", 403);
    const key = process.env.EMBEDDING_SECRETS_KEY,
        instant = process.env.VANTAGE_GROUNDING_M3_AS_OF;
    if (
        !key ||
        Buffer.from(key, "base64").byteLength !== 32 ||
        instant !== "2026-10-19T12:00:00.000Z"
    )
        return null;
    configureSecretBox({ key });
    const resolved = await requireWorkspaceContext();
    if (!resolved.success) return resolved.response;
    if (!canUseVantage(resolved.data))
        return NextResponse.json({ error: "Vantage access denied." }, { status: 403 });
    connection ??= createDb({ url: process.env.DATABASE_URL! });
    await assertM3BudgetDatabase(connection.client);
    return createGroundingService({
        database: connection.db,
        now: () => new Date(instant),
        resolveExecution: createGroundingExecutionResolver(connection.client),
    });
}
export async function groundingRoute(
    request: Request,
    action: (
        service: NonNullable<Exclude<Awaited<ReturnType<typeof groundingSession>>, NextResponse>>
    ) => Promise<unknown>
) {
    try {
        const service = await groundingSession(request);
        if (!service) return NextResponse.json({ error: "Not found." }, { status: 404 });
        if (service instanceof NextResponse) return service;
        return NextResponse.json(await action(service));
    } catch (error) {
        if (
            error instanceof VantageError ||
            error instanceof ContextPortErrorV0 ||
            error instanceof CompanyArchitectureHostErrorV0
        )
            return NextResponse.json(
                { error: error.message, ...("code" in error ? { code: error.code } : {}) },
                { status: error.status }
            );
        console.error(
            "[vantage] grounding request failed",
            JSON.stringify({
                name: error instanceof Error ? error.name : "unknown",
                location: error instanceof Error ? error.stack?.split("\n").slice(1, 4) : undefined,
                code:
                    typeof error === "object" && error && "code" in error
                        ? String(error.code)
                        : undefined,
                reason:
                    error instanceof Error && /^M3 [a-zA-Z :,-]+$/.test(error.message)
                        ? error.message
                        : undefined,
            })
        );
        return NextResponse.json({ error: "Unable to complete grounded review." }, { status: 500 });
    }
}
