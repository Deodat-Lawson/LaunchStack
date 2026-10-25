/** Offline synthetic demo. No server, database connection, .env loading or network tools. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDynamicRetrievalProviderV0 } from "../src/vantage/dynamic-retrieval/retrieve.ts";
import { runDynamicContextV0 } from "../src/vantage/dynamic-retrieval/pipeline.ts";
import { createFixtureV0Ports } from "../src/vantage/context-v0/mocks.ts";

const names = ["retrieval", "stop", "internal", "public", "timeout", "acl"];
const args = process.argv.slice(2);
let scenario = "all";
let json = false;
for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--scenario") scenario = args[++index];
    else if (arg === "--help") {
        console.log(`Usage: pnpm --filter @launchstack/pipelines demo:retrieval [--scenario all|${names.join("|")}] [--json]
Uses synthetic data from October 12–19, 2026. Public and database tools are local doubles.
--json prints complete results, including the evidence snapshot and context manifest.
An assertion failure exits with a nonzero status.`);
        process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}. Use --help.`);
}
if (scenario !== "all" && !names.includes(scenario))
    throw new Error("Unknown scenario. Use --help.");
const fixture = JSON.parse(
    await readFile(
        new URL("../../fixtures/vantage-context-v0/normal.json", import.meta.url),
        "utf8"
    )
);
const budgets = {
    maxSources: 20,
    maxQueries: 3,
    maxExcerptChars: 8000,
    maxTokens: 8000,
    timeoutMs: 5000,
};

async function run(name) {
    const input = structuredClone(fixture.retrievalInput);
    input.budgets = { ...budgets };
    if (name === "retrieval") {
        input.verifiedRoleContext.roleIds.push("engineering");
        input.verifiedRoleContext.roles.push({
            roleId: "engineering",
            description: "Engineering",
            responsibilities: ["Deployment reliability"],
            priorities: ["Resolve blockers"],
        });
        const source = (id, excerpt, date) => ({
            ...input.sourceCatalog.find(entry => entry.source.kind === "ev"),
            source: { kind: "doc", id, version: "v1" },
            excerpt,
            sourceDate: date,
        });
        input.sourceCatalog = [
            source(
                "old-open-deployment",
                "Deployment reliability blocker remains open.",
                "2026-09-01T00:00:00Z"
            ),
            source(
                "old-engineering-guide",
                "Deployment reliability operating guide.",
                "2026-09-02T00:00:00Z"
            ),
            source(
                "weekly-risk",
                "Company direction and weekly risks changed.",
                "2026-10-17T00:00:00Z"
            ),
            source("lunch-menu", "Lunch menu changed.", "2026-10-18T00:00:00Z"),
        ];
        const result = await createDynamicRetrievalProviderV0({
            metadata: [
                {
                    source: input.sourceCatalog[0].source,
                    state: { asOf: input.reportWindow.asOf, value: "open" },
                },
            ],
        }).retrieve(input);
        assert.equal(result.unresolvedOlderItems[0]?.source.id, "old-open-deployment");
        assert.equal(result.roleMatches[0]?.source.id, "old-engineering-guide");
        assert.equal(result.recentChanges.length, 2);
        assert.deepEqual(
            result.recentChanges.find(entry => entry.source.id === "lunch-menu").roleIds,
            []
        );
        return { passed: true, result };
    }
    if (name === "acl") {
        input.sourceCatalog[0].companyId = "another-company";
        await assert.rejects(
            () => createDynamicRetrievalProviderV0().retrieve(input),
            /invalid or unauthorized/
        );
        return {
            passed: true,
            result: {
                status: "blocked",
                reason: "Foreign-company source rejected before retrieval.",
            },
        };
    }
    if (name === "timeout") {
        input.budgets.timeoutMs = 30;
        const result = await createDynamicRetrievalProviderV0({
            search: { search: () => new Promise(() => {}) },
        }).retrieve(input);
        assert.equal(result.status, "timeout");
        return { passed: true, result };
    }
    const projection = fixture.researchPlan.publicSafeQueryProjection[0];
    const question =
        name === "stop"
            ? {
                  id: "roadmap",
                  question: "Do we have roadmap constraints?",
                  requiredTerms: ["roadmap", "constraints"],
              }
            : name === "internal"
              ? {
                    id: "risk",
                    question: "What unresolved weekly risk exists?",
                    requiredTerms: ["unresolved"],
                }
              : {
                    id: "market",
                    question: "What is the market funding eligibility?",
                    requiredTerms: ["funding", "eligibility"],
                    publicProjectionIds: [projection.projectionId],
                };
    const calls = [];
    const result = await runDynamicContextV0(
        {
            principalRef: input.actor.principalRef,
            companyId: input.actor.companyId,
            reportWindow: input.reportWindow,
            budgets,
            runId: `demo-${name}`,
            inputVersion: "synthetic-demo-v1",
        },
        createFixtureV0Ports(fixture),
        {
            // Simulate no initial search hits so the internal gap can be filled in Stage 2.
            retrieval:
                name === "internal"
                    ? { search: { search: async () => ({ hits: [], truncated: false }) } }
                    : undefined,
            research: {
                questions: [question],
                approvedPublicQueries: [projection],
                publicCitations: fixture.researchResult.citations,
                tools: {
                    internal: async request => {
                        calls.push({ tool: "internal (synthetic)", source: request.source });
                        return [request.source];
                    },
                    public: async request => {
                        assert.deepEqual(Object.keys(request).sort(), ["limit", "query", "signal"]);
                        assert.equal(request.query, projection.query);
                        calls.push({ tool: "public (synthetic)", query: request.query });
                        return structuredClone(fixture.researchResult.citations);
                    },
                },
            },
        }
    );
    assert.equal(result.research.mode, name === "stop" ? "STOP" : name);
    assert.equal(result.research.status, name === "stop" ? "stopped" : "complete");
    assert.ok(result.manifest.selectedRefs.some(ref => ref.id === "doc-starred-roadmap"));
    return { passed: true, calls, result };
}

const results = [];
if (!json) console.log("Vantage retrieval demo — synthetic data, no live services\n");
for (const name of scenario === "all" ? names : [scenario]) {
    const record = { scenario: name, ...(await run(name)) };
    results.push(record);
    if (json) continue;
    console.log(`PASS ${name}`);
    if (name === "retrieval") {
        for (const lane of ["roleMatches", "recentChanges", "unresolvedOlderItems"]) {
            console.log(`  ${lane}:`);
            for (const item of record.result[lane])
                console.log(
                    `    ${item.source.id}@${item.source.version} — roles: ${item.roleIds.join(", ") || "none"}`
                );
        }
    } else if (record.result.research) {
        console.log(
            `  Research: ${record.result.research.mode} — ${record.result.research.gapPurpose}`
        );
        for (const call of record.calls)
            console.log(`  Tool: ${call.tool} — ${call.query ?? call.source.id}`);
        console.log(
            `  Manifest: ${record.result.manifest.status}; ${record.result.evidenceSnapshot.entries.length} sources; required personal star retained`
        );
    } else
        console.log(
            `  Status: ${record.result.status}${record.result.reason ? ` — ${record.result.reason}` : ""}`
        );
    console.log();
}
if (json) console.log(JSON.stringify({ mode: "synthetic", results }, null, 2));
else console.log(`${results.length} scenario(s) passed. Use --json to inspect full results.`);
