import { NextResponse } from "next/server";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspacePermission, type WorkspaceContext } from "~/lib/require-workspace-context";

export function personalContextJson(data: unknown, status = 200) {
    return NextResponse.json(data, {
        status,
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
}
export async function contextBody(request: Request): Promise<unknown> {
    // Fetch sends Origin on browser mutations; reject cross-origin submissions without trusting caller IDs.
    const origin = request.headers.get("origin");
    // Containers/proxies can give Next an internal URL. Use the same configured
    // public origin as authentication instead of rejecting legitimate browser saves.
    const expectedOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (origin && origin !== expectedOrigin)
        throw new ContextPortErrorV0("Invalid request origin.", 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
        throw new ContextPortErrorV0("Send a JSON request.", 400);
    const text = await request.text();
    if (text.length > 8192) throw new ContextPortErrorV0("Request is too large.", 400);
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new ContextPortErrorV0("Send valid JSON.", 400);
    }
}
export async function personalContextRoute(run: (ctx: WorkspaceContext) => Promise<unknown>) {
    try {
        const ctx = await requireWorkspacePermission("documents.read");
        if (!ctx.success) return ctx.response;
        const result = await run(ctx.data);
        return result instanceof Response ? result : personalContextJson(result);
    } catch (error) {
        if (error instanceof ContextPortErrorV0)
            return personalContextJson({ error: error.message }, error.status);
        // SQL may contain private documents; never return or log driver error contents.
        console.error("[vantage-personal-context] Request failed.");
        return personalContextJson(
            { error: "Personal context is unavailable. Please try again." },
            503
        );
    }
}
