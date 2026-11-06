import { NextResponse } from "next/server";
import { configureSecretBox } from "@launchstack/store/crypto";
import { VantageError } from "@launchstack/pipelines/vantage";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { canUseVantage } from "~/server/vantage/access";
import { createContextualService } from "~/server/vantage/contextual-service";
import { CompanyArchitectureHostErrorV0 } from "~/server/vantage/company-architecture";

/** Isolated milestone entry only; the underlying host still rechecks DB authority. */
export async function contextualSession(request?: Request) {
    let url: URL;
    try {
        url = new URL(process.env.DATABASE_URL ?? "");
    } catch {
        return null;
    }
    if (
        process.env.VANTAGE_FINANCE_M1_ENABLED !== "true" ||
        process.env.NODE_ENV === "production" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== "55446" ||
        url.pathname !== "/vantage_finance_m1_20261105" ||
        process.env.VANTAGE_TEST_DATABASE_URL !== process.env.DATABASE_URL
    )
        return null;
    const storageKey = process.env.EMBEDDING_SECRETS_KEY;
    if (!storageKey || Buffer.from(storageKey, "base64").byteLength !== 32) return null;
    // Configure the existing SecretBox primitive directly; do not bootstrap providers.
    configureSecretBox({ key: storageKey });
    const instant = process.env.VANTAGE_FINANCE_M1_AS_OF;
    if (!instant || !Number.isFinite(Date.parse(instant))) return null;
    if (request && !["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
            throw new ContextPortErrorV0("Cross-origin mutation denied.", 403);
    }
    const resolved = await requireWorkspaceContext();
    if (!resolved.success) return resolved.response;
    if (!canUseVantage(resolved.data))
        return NextResponse.json({ error: "Vantage access denied." }, { status: 403 });
    return createContextualService({ now: () => new Date(instant) });
}

export async function contextualRoute(
    request: Request,
    action: (
        service: NonNullable<Exclude<Awaited<ReturnType<typeof contextualSession>>, NextResponse>>
    ) => Promise<unknown>
) {
    try {
        const service = await contextualSession(request);
        if (!service) return NextResponse.json({ error: "Not found." }, { status: 404 });
        if (service instanceof NextResponse) return service;
        return NextResponse.json(await action(service));
    } catch (error) {
        if (error instanceof ContextPortErrorV0 || error instanceof VantageError || error instanceof CompanyArchitectureHostErrorV0)
            return NextResponse.json(
                {
                    error: error.message,
                    ...(error instanceof VantageError || error instanceof CompanyArchitectureHostErrorV0 ? { code: error.code } : {}),
                },
                { status: error.status }
            );
        console.error("[vantage] contextual request failed.");
        return NextResponse.json(
            { error: "Unable to complete this review request." },
            { status: 500 }
        );
    }
}
