#!/usr/bin/env tsx
/**
 * Agent worker node.
 *
 * Run this on any machine that should host meeting participants. It dials the
 * hub, registers the personas it can serve, and answers turn requests. All
 * traffic is outbound, so the worker needs no public address:
 *
 *   COLLAB_HUB_URL=https://app.example.com/api \
 *   COLLAB_NODE_ID=gpu-box-1 \
 *   COLLAB_SECRET=... \
 *   COLLAB_PERSONAS=eng,fin \
 *   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5 \
 *   pnpm --filter @launchstack/web collab:worker
 *
 * Set `COLLAB_WORKER_SCRIPT` to a JSON map of persona id → lines to run the
 * worker without a model. That mode is what the two-machine integration test
 * uses, and it is also the fastest way to prove connectivity from a new host
 * before pointing real credentials at it.
 */

import {
    AgentWorker,
    HubClient,
    LlmAgentRuntime,
    ScriptedAgentRuntime,
    type AgentRuntime,
    type CollabChatFn,
} from "@launchstack/core/collab";

interface WorkerEnv {
    hubUrl: string;
    nodeId: string;
    secret: string;
    personaIds: string[];
    label?: string;
    pollWaitMs: number;
}

function readEnv(): WorkerEnv {
    const hubUrl = process.env.COLLAB_HUB_URL;
    const nodeId = process.env.COLLAB_NODE_ID;
    const secret = process.env.COLLAB_SECRET;

    const missing = [
        ["COLLAB_HUB_URL", hubUrl],
        ["COLLAB_NODE_ID", nodeId],
        ["COLLAB_SECRET", secret],
    ]
        .filter(([, v]) => !v)
        .map(([k]) => k);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }

    return {
        hubUrl: hubUrl!,
        nodeId: nodeId!,
        secret: secret!,
        personaIds: (process.env.COLLAB_PERSONAS ?? "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean),
        label: process.env.COLLAB_NODE_LABEL,
        pollWaitMs: Number(process.env.COLLAB_POLL_WAIT_MS ?? 20_000),
    };
}

/**
 * Minimal OpenAI-compatible chat call. The worker deliberately does not import
 * the app's model registry — a remote node should need nothing but an endpoint
 * URL and a model name.
 */
function buildChatFn(): CollabChatFn {
    const baseUrl = process.env.LLM_BASE_URL;
    const model = process.env.LLM_MODEL;
    if (!baseUrl || !model) {
        throw new Error(
            "Set LLM_BASE_URL and LLM_MODEL for model-backed turns, or COLLAB_WORKER_SCRIPT for scripted turns."
        );
    }
    const apiKey = process.env.LLM_API_KEY;

    return async ({ messages, temperature, maxTokens, signal }) => {
        const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: temperature ?? 0.6,
                max_tokens: maxTokens ?? 700,
            }),
            signal,
        });

        if (!response.ok) {
            throw new Error(`Chat endpoint returned ${response.status}: ${await response.text()}`);
        }
        const body = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error("Chat endpoint returned no content");
        return content;
    };
}

function buildRuntimes(nodeId: string): AgentRuntime[] {
    const scripted = process.env.COLLAB_WORKER_SCRIPT;
    if (scripted) {
        return [
            new ScriptedAgentRuntime(JSON.parse(scripted) as Record<string, string[]>, { nodeId }),
        ];
    }
    return [new LlmAgentRuntime(buildChatFn(), { nodeId })];
}

async function main(): Promise<void> {
    const env = readEnv();
    const client = new HubClient({ hubUrl: env.hubUrl, nodeId: env.nodeId, secret: env.secret });

    const worker = new AgentWorker({
        client,
        runtimes: buildRuntimes(env.nodeId),
        personaIds: env.personaIds,
        label: env.label,
        pollWaitMs: env.pollWaitMs,
        onError: (error, phase) => {
            console.error(`[collab-worker:${phase}] ${error.message}`);
        },
    });

    await worker.start();
    // The parent process (or an operator) watches for this line to know the
    // node is registered and serving.
    console.log(
        `[collab-worker] ready node=${env.nodeId} hub=${env.hubUrl} personas=${env.personaIds.join(",") || "*"}`
    );

    let stopping = false;
    const shutdown = (signal: string) => {
        if (stopping) return;
        stopping = true;
        console.log(`[collab-worker] ${signal} — deregistering`);
        void worker.stop().then(() => process.exit(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
    console.error(`[collab-worker] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
