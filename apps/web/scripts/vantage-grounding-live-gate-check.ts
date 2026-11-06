/** Pure synthetic live-wiring checks. No DB approval, real credentials, or external request. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import semantic from "../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import { prepareLivePilotContext } from "../../../pipelines/src/vantage/evaluation-live/pilot-context";
import type { JosephSemanticCase } from "../../../pipelines/src/vantage/evaluation-integration/joseph-adapter";
import {
    createM3OfflineModelSettings,
    bindM3Attempt,
    serializeM3ModelSettings,
} from "../../../pipelines/src/vantage/experiments/live-grounding-m3-transport";
import {
    buildM3OfflinePlan,
    m3ConfigurationHash,
} from "../../../pipelines/src/vantage/experiments/live-grounding-m3";
import {
    assertM3BudgetAuthorized,
    m3PlanHash,
    type M3BudgetSnapshot,
    type M3RequestBudget,
} from "../../../pipelines/src/vantage/evaluation-live/m3-request-budget";
import {
    resolveApprovedGroundingLive,
    parseGroundingLiveConfiguration,
    type GroundingLiveConfiguration,
} from "../src/server/vantage/grounding-live-execution";
import type { PreparedContextualReport } from "../src/server/vantage/contextual-host";
import { invokeStructuredAttempt } from "@launchstack/llm";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export async function checkGroundingLiveGate() {
    const pilot = await prepareLivePilotContext(
        semantic.cases.find(v => v.id === "conflicting-metrics")! as JosephSemanticCase
    );
    const input = {
        envelope: pilot.envelope,
        roleContext: pilot.prepared.roleContext,
        sourceRefs: {
            finance: pilot.prepared.documents.find(v => v.originalId === "finance")!.source,
            sales: pilot.prepared.documents.find(v => v.originalId === "sales")!.source,
        },
    };
    const prepared = {
        ...input,
        baseline: {
            activeReportId: null,
            pointerVersion: 0,
            reportVersion: null,
            ciphertextHash: null,
        },
    } as PreparedContextualReport;
    const model = (kind: "generation" | "judge") => {
        const settings = createM3OfflineModelSettings({
            baseUrl: `https://synthetic.invalid/${kind}/v1`,
            kind,
            yaml: readFileSync(
                resolve(
                    ROOT,
                    "apps/web/config",
                    kind === "generation"
                        ? "chat-models.yaml"
                        : "chat-models.vantage-demo.azure.yaml"
                ),
                "utf8"
            ),
        });
        settings.config.endpoint.apiKey = "m3-live-unbound-no-credential";
        return {
            ...settings,
            identity: { ...settings.identity, availability: "verified" as const },
        };
    };
    const generation = model("generation"),
        judge = model("judge"),
        implementationHash = "a".repeat(64),
        pricing = { status: "verified" as const, evidenceHash: "b".repeat(64) };
    const plan = buildM3OfflinePlan(input, { generation, judge, implementationHash, pricing });
    plan.mode = "live";
    plan.bindings.configHash = m3ConfigurationHash({
        mode: "live",
        generation,
        judge,
        implementationHash,
        pricing,
    });
    const planHash = m3PlanHash(plan),
        snapshot: M3BudgetSnapshot = {
            budgetKey: "finance-live-pilot",
            planHash,
            plan,
            approvalState: "approved-live",
            approvalManifest: {
                approvalState: "approved",
                planHash,
                project: "vantage-grounding-m3-20261106",
                maxRequests: 2,
                authorizationRef: "SYNTHETIC-UNIT-ONLY-NOT-DATABASE-APPROVAL",
                expectedBaseline: prepared.baseline,
            },
            reserved: 0,
            totalLimit: 2,
            requests: [],
        };
    const config: GroundingLiveConfiguration = {
        version: "vantage-m3-live-runtime/v1",
        project: "vantage-grounding-m3-20261106",
        planHash,
        implementationHash,
        generation,
        judge,
        pricing,
        credentials: {
            generation: "VANTAGE_M3_GENERATION_API_KEY",
            judge: "VANTAGE_M3_JUDGE_API_KEY",
        },
    };
    let reads = 0,
        fetches = 0;
    const dispatched: unknown[] = [];
    const budget: M3RequestBudget = {
        async snapshot() {
            return structuredClone(snapshot);
        },
        async beforeDispatch(intent) {
            dispatched.push(intent);
            return {
                requestId: intent.requestId,
                ordinal: 1,
                mode: "live",
                planHash,
                budgetKey: snapshot.budgetKey,
            };
        },
        async completion(receipt) {
            dispatched.push(receipt);
        },
        async verifyReceipt() {
            throw new Error("Not part of synthetic adapter-only test");
        },
    };
    const fetch: typeof globalThis.fetch = async (_url, init) => {
        fetches++;
        assert.equal(init?.redirect, "manual");
        return new Response(
            JSON.stringify({
                id: "synthetic-sdk-response",
                object: "chat.completion",
                created: 1,
                model: generation.identity.wireModelId,
                choices: [
                    {
                        index: 0,
                        message: { role: "assistant", content: JSON.stringify({ ok: true }) },
                        finish_reason: "stop",
                    },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    };
    const base = {
        prepared,
        configuration: config,
        implementationHash,
        budget,
        assertAuthorized: assertM3BudgetAuthorized,
        readCredential: () => {
            reads++;
            return "synthetic-test-key-not-real";
        },
        fetch,
    };
    const mutations: [
        string,
        (value: GroundingLiveConfiguration, state: M3BudgetSnapshot) => void,
    ][] = [
        [
            "unapproved",
            (_c, s) => {
                s.approvalState = "unapproved";
            },
        ],
        [
            "stale implementation",
            c => {
                c.implementationHash = "0".repeat(64);
            },
        ],
        [
            "stale input",
            (_c, s) => {
                s.plan.bindings.inputHash = "0".repeat(64);
            },
        ],
        [
            "stale source freeze",
            (_c, s) => {
                s.plan.bindings.sourceFreezeHash = "0".repeat(64);
            },
        ],
        [
            "proposed identity",
            c => {
                c.generation.identity.availability = "proposed";
            },
        ],
        [
            "missing pricing",
            c => {
                c.pricing.evidenceHash = "";
            },
        ],
        [
            "approved baseline drift",
            (_c, s) => {
                s.approvalManifest = {
                    ...(s.approvalManifest as Record<string, unknown>),
                    expectedBaseline: {
                        activeReportId: null,
                        pointerVersion: 1,
                        reportVersion: null,
                        ciphertextHash: null,
                    },
                };
            },
        ],
        [
            "schema drift",
            (_c, s) => {
                s.plan.bindings.promptSchemaHash = "0".repeat(64);
            },
        ],
        [
            "model definitions drift",
            c => {
                const name = c.generation.config.models.keys().next().value;
                if (name)
                    c.generation.config = {
                        ...c.generation.config,
                        models: new Map(
                            [...c.generation.config.models].filter(([id]) => id !== name)
                        ),
                    };
            },
        ],
        [
            "embedded credential",
            c => {
                c.generation.config.endpoint.apiKey = "SYNTHETIC-EMBEDDED-KEY-FORBIDDEN";
            },
        ],
        [
            "exhausted",
            (_c, s) => {
                s.reserved = 2;
            },
        ],
    ];
    const saved = structuredClone(snapshot);
    for (const [name, mutate] of mutations) {
        Object.assign(snapshot, structuredClone(saved));
        const c = structuredClone(config);
        mutate(c, snapshot);
        await assert.rejects(
            () => resolveApprovedGroundingLive({ ...base, configuration: c }),
            /./,
            name
        );
        assert.equal(reads, 0);
        assert.equal(fetches, 0);
    }
    Object.assign(snapshot, saved);
    const wire = JSON.parse(
        JSON.stringify({
            ...config,
            generation: serializeM3ModelSettings(generation),
            judge: serializeM3ModelSettings(judge),
        })
    );
    assert.equal("apiKey" in wire.generation.config.endpoint, false);
    const hydrated = parseGroundingLiveConfiguration(wire);
    assert.ok(hydrated.generation.config.models instanceof Map);
    const options = await resolveApprovedGroundingLive({ ...base, configuration: hydrated });
    assert.equal(reads, 2);
    assert.equal(options.mode, "live");
    assert.equal(options.adapter.kind, "live-fetch");
    assert.equal(fetches, 0, "Resolving an approved configuration does not dispatch");
    assert.ok(plan.bindings.inputHash);
    const attempt = bindM3Attempt({
        kind: "generation",
        mode: "live",
        settings: options.generation,
        adapter: options.adapter,
        budget,
        planHash,
        configHash: plan.bindings.configHash,
        inputHash: plan.bindings.inputHash,
    });
    const result = await invokeStructuredAttempt(
        attempt.model,
        z.object({ ok: z.boolean() }),
        [new HumanMessage("Synthetic adapter check")],
        { signal: new AbortController().signal, timeoutMs: 1000, maxOutputTokens: 100 }
    );
    assert.equal(result.result.ok, true);
    assert.equal(fetches, 1);
    assert.equal(dispatched.length, 2);
    return {
        checks: mutations.length + 2,
        realCredentialsRead: 0,
        realDatabaseApprovals: 0,
        actualExternalRequests: 0,
        injectedSdkFetches: fetches,
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    checkGroundingLiveGate()
        .then(v => console.log(JSON.stringify(v)))
        .catch(e => {
            console.error(e);
            process.exitCode = 1;
        });
}
