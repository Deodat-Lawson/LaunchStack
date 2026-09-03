/**
 * GitHub push webhook — stage B's fast path (design §3.2). Signature-checked,
 * outbox-write-only: verify, resolve the workspaces mirroring the pushed
 * repo, open (or coalesce into) their pending sync request, send the Inngest
 * nudge, return. No git work happens in this request, and the response never
 * reveals whether a repository is connected.
 *
 * Webhooks are an optimization; the poll reconciler is the guarantee — a
 * lost delivery costs sync latency, never correctness.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { findWorkspacesByRepo, requestSync } from "@launchstack/pipelines/repo-workspace/db";
import { inngest } from "~/server/inngest/client";
import { verifyGithubSignature } from "~/server/services/github-webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

const PushPayloadSchema = z.object({
    repository: z.object({ full_name: z.string().min(3).max(500) }),
});

export async function POST(request: Request) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
        // Refuse loudly rather than accept unauthenticated pushes.
        return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyGithubSignature(secret, rawBody, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const eventType = request.headers.get("x-github-event");
    if (eventType === "ping") return NextResponse.json({ ok: true });
    if (eventType !== "push") return NextResponse.json({ ignored: eventType }, { status: 202 });

    let fullName: string;
    try {
        const payload = PushPayloadSchema.parse(JSON.parse(rawBody));
        fullName = payload.repository.full_name;
    } catch {
        return NextResponse.json({ error: "Unrecognized payload" }, { status: 400 });
    }

    const slash = fullName.indexOf("/");
    if (slash <= 0) return NextResponse.json({ error: "Unrecognized payload" }, { status: 400 });
    const owner = fullName.slice(0, slash);
    const repo = fullName.slice(slash + 1);

    try {
        const workspaces = await findWorkspacesByRepo({ provider: "github", owner, repo });
        for (const workspace of workspaces) {
            // Coalesces into an existing pending request during push bursts.
            await requestSync(workspace.id, "webhook");
        }
        if (workspaces.length > 0) {
            await inngest.send(
                workspaces.map(workspace => ({
                    name: "repo-workspace/sync.requested" as const,
                    data: { workspaceId: workspace.id },
                }))
            );
        }
        // 202 whether or not anything matched — a webhook probe must not
        // learn which repositories are connected here.
        return NextResponse.json({ accepted: true }, { status: 202 });
    } catch (error) {
        console.error("[GithubWebhook] Failed to enqueue sync:", error);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}
