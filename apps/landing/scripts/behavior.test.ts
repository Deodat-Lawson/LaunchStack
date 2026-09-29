import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    SAMPLE_SOURCES,
    SAMPLE_QUESTIONS,
    resolveSampleQuestion,
} from "../src/app/_components/workspaceDemoModel";
import {
    CONFIG_REVISION,
    GUIDES,
    LEGACY_GUIDE_IDS,
    filterGuides,
    resolveGuide,
} from "../src/app/deployment/deploymentContent";

const sourceIds = SAMPLE_SOURCES.map(source => source.id);
void test("sample answers only resolve when their required context is selected", () => {
    SAMPLE_QUESTIONS.forEach((question, index) => {
        assert.deepEqual(resolveSampleQuestion(question.question, sourceIds), {
            kind: "answer",
            index,
        });
        assert.deepEqual(resolveSampleQuestion(question.question, []), {
            kind: "missing",
            missing: question.sources,
        });
        for (const required of question.sources) {
            const answer = resolveSampleQuestion(
                question.question,
                sourceIds.filter(id => id !== required)
            );
            assert.equal(answer.kind, "missing");
            if (answer.kind === "missing") assert.deepEqual(answer.missing, [required]);
        }
    });
});
void test("custom prompts are not presented as generated answers", () => {
    assert.deepEqual(resolveSampleQuestion("Tell me my revenue", sourceIds), {
        kind: "unsupported",
    });
    assert.deepEqual(resolveSampleQuestion("  WHAT SHOULD WE FOCUS ON?!  ", sourceIds), {
        kind: "answer",
        index: 0,
    });
});
void test("all legacy guide links resolve and unknown ids fail safely", () => {
    for (const [legacy, current] of Object.entries(LEGACY_GUIDE_IDS))
        assert.equal(resolveGuide(legacy).id, current);
    for (const unknown of [undefined, "missing", "constructor", "__proto__"])
        assert.equal(resolveGuide(unknown).id, "main");
    assert.equal(new Set(GUIDES.map(guide => guide.id)).size, GUIDES.length);
    for (const guide of GUIDES)
        for (const block of guide.blocks)
            for (const link of block.links ?? []) {
                if (link.href.startsWith("/deployment?section=")) {
                    const id = new URL(link.href, "https://example.com").searchParams.get(
                        "section"
                    )!;
                    assert.equal(resolveGuide(id).id, id);
                }
            }
});
void test("guide search finds actual environment variables and supports multiple terms", () => {
    assert.ok(filterGuides("EMBEDDING_INDEX").some(guide => guide.id === "ai-providers"));
    assert.ok(filterGuides("google oauth").some(guide => guide.id === "connections"));
    assert.ok(filterGuides("FILE_ACCESS_TOKEN_SECRET").some(guide => guide.id === "storage"));
    assert.equal(filterGuides("no-such-config-xyz").length, 0);
    assert.equal(filterGuides("   ").length, GUIDES.length);
});

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
void test("new landing styles reference real shared tokens", () => {
    const tokens = readFileSync(
        path.resolve(appRoot, "../../packages/design-tokens/tokens.css"),
        "utf8"
    );
    const known = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    for (const file of ["workspaceDemo.module.css", "deploymentGuide.module.css"]) {
        const css = readFileSync(path.join(appRoot, "src/styles", file), "utf8");
        for (const variable of css.matchAll(/var\((--[\w-]+)/g))
            assert.ok(known.has(variable[1]), `${file}: ${variable[1]}`);
    }
});

// Set this to the product checkout to audit the published reference against its actual configuration.
const productRoot = process.env.DEPLOYMENT_SOURCE_ROOT;
void test(
    "deployment instructions match the current product source",
    { skip: !productRoot },
    () => {
        const read = (file: string) => readFileSync(path.join(productRoot!, file), "utf8");
        for (const guide of GUIDES)
            for (const source of guide.sources) {
                const relative = source.href.split(`/blob/${CONFIG_REVISION}/`)[1];
                assert.ok(relative && existsSync(path.join(productRoot!, relative)), source.href);
            }
        const web = JSON.parse(read("apps/web/package.json")) as {
            scripts: Record<string, string>;
        };
        assert.match(web.scripts["db:migrate"]!, /@launchstack\/store/);
        assert.match(web.scripts["db:migrate"]!, /--set=product/);
        assert.match(web.scripts["inngest:dev"]!, /8020\/api\/inngest/);
        const worker = JSON.parse(read("apps/worker/package.json")) as {
            scripts: Record<string, string>;
        };
        assert.ok(worker.scripts.dev);
        assert.match(read("apps/web/src/lib/storage.ts"), /"s3"\s*\|\s*"database"/);
        assert.match(read("packages/llm/src/presets.ts"), /name: "google\/gemini-2.5-flash"/);
        assert.match(
            read("packages/llm/src/embeddings/index-registry.ts"),
            /indexKey: "gemini-embedding-768"/
        );
        const docs = JSON.stringify(GUIDES);
        assert.doesNotMatch(docs, /@launchstack\/core|clerk\.com/);
        const definitions = [
            read("apps/web/src/env.ts"),
            read(".env.example"),
            read("docker-compose.yml"),
            read("docker-compose.prod.yml"),
            read("apps/landing/src/config/site.ts"),
        ].join("\n");
        for (const guide of GUIDES)
            for (const block of guide.blocks) {
                if (block.file?.startsWith(".env"))
                    for (const setting of (block.code ?? "").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) {
                        assert.ok(
                            definitions.includes(setting[1]!),
                            `Unknown setting: ${setting[1]}`
                        );
                    }
            }
    }
);
