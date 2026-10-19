/** Synthetic generation harness. No database, server authentication or automatic .env loading. */
import { readFile, writeFile } from "node:fs/promises";
import { resolveChatModel, createChatModelsConfig } from "@launchstack/llm";
import {
    createGenerationPort,
    generateWeeklyAgendaV1,
    GENERATION_BUDGETS,
} from "../src/vantage/generation-v1.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const force = args.includes("--force-fallback");
if (live && force) throw new Error("Choose --live or --force-fallback.");
const examples = JSON.parse(
    await readFile(
        new URL("../../docs/design/examples/weekly-decision-agenda-v1.json", import.meta.url),
        "utf8"
    )
).internal;
let resolveModel = () => null;
if (live) {
    if (!process.env.CHAT_BASE_URL || !process.env.CHAT_API_KEY) {
        console.log(
            JSON.stringify({
                status: "skipped",
                mode: "live",
                reason: "CHAT_BASE_URL and CHAT_API_KEY are required. No provider call was made.",
            })
        );
        process.exitCode = 2;
    } else {
        const path = process.env.CHAT_MODELS_CONFIG;
        const yaml = await readFile(
            path ?? new URL("../../apps/web/config/chat-models.yaml", import.meta.url),
            "utf8"
        );
        const config = createChatModelsConfig({
            yaml,
            endpoint: { baseUrl: process.env.CHAT_BASE_URL, apiKey: process.env.CHAT_API_KEY },
        });
        resolveModel = () =>
            resolveChatModel({ config, route: "default", maxOutputTokens: 2400, timeoutMs: 20000 });
    }
}
if (!process.exitCode) {
    const records = [];
    const generate = force
        ? createGenerationPort(async () => {
              throw Object.assign(new Error("Synthetic provider outage"), { status: 503 });
          })
        : generateWeeklyAgendaV1;
    if (force) resolveModel = () => ({ modelId: "forced-outage-fixture" });
    for (const name of ["input", "emptyInput", "enrichmentInput"]) {
        const input = structuredClone(examples[name]);
        if (!live && !force) input.generationMode = "rules";
        const before = JSON.stringify(input);
        const result = await generate(input, {
            resolveModel,
            signal: new AbortController().signal,
            budgets: GENERATION_BUDGETS,
        });
        if (JSON.stringify(input) !== before) throw new Error("Input mutation detected.");
        const expectedMode = live && name !== "emptyInput" ? "ai" : "rules";
        const passed =
            result.execution.mode === expectedMode &&
            (!force ||
                name === "emptyInput" ||
                result.execution.fallbackReason === "provider-error");
        if (!passed) process.exitCode = 1;
        records.push({ fixture: name, passed, result });
        console.log(
            JSON.stringify({
                fixture: name,
                evidence: live
                    ? "real-provider"
                    : force
                      ? "forced-provider-failure-double"
                      : "deterministic-rules",
                passed,
                execution: result.execution,
                topics: result.draft.topics.length,
                enhancements: result.enhancements.length,
            })
        );
    }
    const outputIndex = args.indexOf("--output");
    if (outputIndex >= 0) {
        const destination = args[outputIndex + 1];
        if (!destination) throw new Error("--output requires a file path.");
        await writeFile(
            destination,
            JSON.stringify(
                {
                    observedAt: new Date().toISOString(),
                    mode: live ? "live" : force ? "forced-fallback" : "rules",
                    records,
                },
                null,
                2
            ) + "\n"
        );
    }
}
