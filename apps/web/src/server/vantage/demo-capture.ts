/** Body-only diagnostics for the explicitly authorized local synthetic demo. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { ResolvedChatModel } from "@launchstack/llm";
import type { ContextGenerationEnvelopeV0 } from "@launchstack/pipelines/vantage/context-v0";

export async function captureDemoGeneration(
    envelope: ContextGenerationEnvelopeV0,
    model: ResolvedChatModel
) {
    const descriptor = process.env.VANTAGE_CONTEXT_DEMO_FIXTURE;
    const roots = [
        resolve(process.cwd(), "test-output"),
        resolve(process.cwd(), "../../test-output"),
    ];
    if (
        process.env.NODE_ENV !== "development" ||
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true" ||
        !descriptor ||
        !isAbsolute(descriptor) ||
        !roots.some(root => resolve(descriptor).startsWith(root + sep))
    )
        throw new Error("Local synthetic capture is not configured.");
    const directory = resolve(
        dirname(descriptor),
        "generation-attempts",
        `${new Date().toISOString().replace(/[^0-9TZ]/g, "")}-${envelope.v1Input.runId}`
    );
    await mkdir(directory, { recursive: false }).catch(async failure => {
        if ((failure as { code?: string }).code !== "ENOENT") throw failure;
        await mkdir(dirname(directory), { recursive: true });
        await mkdir(directory);
    });
    const secrets = [
        process.env.CHAT_API_KEY,
        process.env.CHAT_BASE_URL,
        process.env.DATABASE_URL,
        process.env.EMBEDDING_SECRETS_KEY,
        process.env.BETTER_AUTH_SECRET,
    ].filter((value): value is string => !!value);
    if (process.env.CHAT_BASE_URL) secrets.push(new URL(process.env.CHAT_BASE_URL).hostname);
    const write = async (name: string, value: unknown) => {
        let body = JSON.stringify(
            value,
            (_, child: unknown) => (typeof child === "bigint" ? child.toString() : child),
            2
        );
        for (const secret of secrets) body = body.split(secret).join("[REDACTED]");
        await writeFile(resolve(directory, name), body + "\n", { flag: "wx", mode: 0o600 });
    };
    await write("input.json", {
        syntheticOnly: true,
        modelId: model.modelId,
        reasoningEffort: model.reasoning?.requestPatch.reasoning_effort ?? null,
        envelope,
    });
    const configuration = (model.chat.lc_kwargs.configuration ?? {}) as Record<string, unknown>;
    const upstream =
        typeof configuration.fetch === "function"
            ? (configuration.fetch as typeof fetch)
            : globalThis.fetch;
    let transport = 0,
        event = 0;
    const observed: typeof fetch = async (input, init) => {
        const attempt = ++transport,
            prefix = `transport-${String(attempt).padStart(2, "0")}`;
        if (typeof init?.body === "string") {
            try {
                await write(`${prefix}.request.json`, { body: JSON.parse(init.body) as unknown });
            } catch {
                await write(`${prefix}.request-unavailable.json`, { bodyCaptured: false });
            }
        }
        const response = await upstream(input, init);
        try {
            const raw = (await response.clone().json()) as {
                choices?: unknown;
                usage?: unknown;
                model?: unknown;
                id?: unknown;
            };
            // Never persist headers, request URL, config/auth objects or raw HTTP error messages.
            await write(`${prefix}.response.json`, {
                httpStatus: response.status,
                choices: raw.choices ?? [],
                usage: raw.usage ?? null,
                model: raw.model ?? null,
                id: raw.id ?? null,
            });
        } catch {
            await write(`${prefix}.response-unavailable.json`, {
                httpStatus: response.status,
                bodyCaptured: false,
            });
        }
        return response;
    };
    // resolveConfiguredChatModel creates a fresh per-request chat. The shared
    // single-attempt transport preserves this configuration when cloning it.
    model.chat.lc_kwargs.configuration = { ...configuration, fetch: observed };
    return {
        directory,
        observeAttempt: async (record: { attempt: number; stage: string; data: unknown }) => {
            await write(`validation-${String(++event).padStart(2, "0")}.json`, record);
        },
    };
}
