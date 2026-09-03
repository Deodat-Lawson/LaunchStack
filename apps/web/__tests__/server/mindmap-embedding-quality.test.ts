/**
 * Embedding-quality eval for published mindmaps (real embeddings).
 *
 * Runs the exact text the publish route produces through the exact chunker
 * and "prepare for embedding" step the worker uses, embeds it with the
 * deployment's configured model, and asks the questions a person would ask
 * about a map. The assertions are retrieval metrics — recall@1 and MRR over a
 * corpus of several maps plus prose decoys — so a rendering change that
 * makes maps harder to find fails here, not in production.
 *
 * Needs an embeddings key: EMBEDDING_API_KEY or OPENAI_API_KEY in the
 * environment, or in apps/web/.env. Skipped otherwise. Costs a few thousand
 * embedding tokens per run.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chunkDocument, prepareForEmbedding } from "@launchstack/conversion/ocr/chunker";
import {
    configureCompanyEmbeddingDefaults,
    createEmbeddingModel,
    resolveEmbeddingIndex,
} from "@launchstack/llm/embeddings";

import { toMarkdownOutline } from "~/app/employer/documents/_mindmap/model/serialize";
import type { MindmapDoc } from "~/app/employer/documents/_mindmap/model/types";
import { LAUNCH_PLAN, treeDoc } from "./mindmap-fixtures";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Read one key from apps/web/.env without dotenv; tests never load it globally. */
function envFromDotfile(name: string): string | undefined {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
    const file = join(__dirname, "..", "..", ".env");
    if (!existsSync(file)) return undefined;
    for (const line of readFileSync(file, "utf8").split("\n")) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (!match || match[1] !== name) continue;
        const raw = match[2]!.trim();
        const unquoted = raw.replace(/^["'](.*)["']$/, "$1");
        return unquoted.length > 0 ? unquoted : undefined;
    }
    return undefined;
}

const apiKey = envFromDotfile("EMBEDDING_API_KEY") ?? envFromDotfile("OPENAI_API_KEY");
const baseUrl = envFromDotfile("EMBEDDING_API_BASE_URL") ?? "https://api.openai.com/v1";
const indexKey = envFromDotfile("EMBEDDING_INDEX");

const describeWithKey = apiKey ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const PIPELINE_CHUNKING = {
    parentMaxTokens: 1000,
    childMaxTokens: 256,
    overlapTokens: 50,
    includePageContext: true,
};

const MAPS: MindmapDoc[] = [
    treeDoc("Q3 launch plan", LAUNCH_PLAN),
    treeDoc("Hiring pipeline", {
        "Hiring pipeline": {
            Sourcing: {
                "LinkedIn outreach": null,
                "Referral bonus programme": null,
                "University career fairs": null,
            },
            Screening: {
                "Recruiter phone screen": null,
                "Take-home exercise, four hours": null,
            },
            Onsite: {
                "System design interview": null,
                "Pairing session with the team": null,
                "Values conversation": null,
            },
            Offer: { "Compensation bands": null, "Two-week decision window": null },
        },
    }),
    treeDoc("Checkout outage postmortem", {
        "Checkout outage postmortem": {
            Timeline: {
                "14:02 payment errors spike": null,
                "14:20 rollback of the pricing service": null,
                "15:05 all clear": null,
            },
            "Root cause": {
                "Expired TLS certificate on the payments gateway": null,
                "Alert routed to a deleted Slack channel": null,
            },
            "Action items": {
                "Automate certificate renewal": null,
                "Audit alert destinations quarterly": null,
            },
        },
    }),
    treeDoc("Mobile app roadmap", {
        "Mobile app roadmap": {
            Now: { "Offline mode for notes": null, "Push notification preferences": null },
            Next: { "Widget for daily summary": null, "Share sheet integration": null },
            Later: { "Apple Watch companion": null, "Tablet layout": null },
        },
    }),
    treeDoc("Data platform architecture", {
        "Data platform architecture": {
            Ingestion: { "Kafka topics per tenant": null, "Debezium change capture": null },
            Storage: { "Iceberg tables on S3": null, "Hot tier in ClickHouse": null },
            Serving: { "dbt models nightly": null, "Metabase dashboards": null },
        },
    }),
];

/** Prose that shares vocabulary with the maps, to make ranking non-trivial. */
const DECOYS: { title: string; text: string }[] = [
    {
        title: "Engineering handbook",
        text:
            "We deploy on Kubernetes with blue-green rollouts and keep Postgres as the system of " +
            "record. Redis fronts the session store. Every service owns its alerts, and alert " +
            "routing is reviewed when a channel is renamed. Certificates are renewed by the " +
            "platform team. Interviews follow a structured loop with a take-home exercise.",
    },
    {
        title: "Board update, August",
        text:
            "Revenue grew eleven percent month over month. The SOC 2 audit is on track. We " +
            "hired one SRE and opened a second role. Stripe migration is complete and invoices " +
            "now go out by email. The Product Hunt launch is planned for the autumn.",
    },
    {
        title: "Support macros",
        text:
            "If a customer cannot see their invoice, check the billing email on the workspace. " +
            "For push notification problems on mobile, ask them to reinstall and re-enable " +
            "notifications in settings. Offline mode syncs when the device reconnects.",
    },
];

interface Query {
    text: string;
    /** Title of the map that should come first. */
    expect: string;
    kind: "label" | "question" | "branch";
}

const QUERIES: Query[] = [
    // Exact labels, as someone who remembers a box would type them.
    { text: "Postgres 16 with read replicas", expect: "Q3 launch plan", kind: "label" },
    { text: "Referral bonus programme", expect: "Hiring pipeline", kind: "label" },
    {
        text: "Expired TLS certificate on the payments gateway",
        expect: "Checkout outage postmortem",
        kind: "label",
    },
    { text: "Apple Watch companion", expect: "Mobile app roadmap", kind: "label" },
    { text: "Debezium change capture", expect: "Data platform architecture", kind: "label" },
    // Natural questions about a map's content.
    { text: "What database does the Q3 launch use?", expect: "Q3 launch plan", kind: "question" },
    { text: "When is the Product Hunt launch?", expect: "Q3 launch plan", kind: "question" },
    {
        text: "How long is the take-home exercise for candidates?",
        expect: "Hiring pipeline",
        kind: "question",
    },
    { text: "Why did checkout go down?", expect: "Checkout outage postmortem", kind: "question" },
    {
        text: "What time was the rollback during the outage?",
        expect: "Checkout outage postmortem",
        kind: "question",
    },
    {
        text: "What is planned for the mobile app later on?",
        expect: "Mobile app roadmap",
        kind: "question",
    },
    {
        text: "Where do the Iceberg tables live?",
        expect: "Data platform architecture",
        kind: "question",
    },
    // Branch-level questions: the answer is a set of siblings.
    { text: "What are the launch risks?", expect: "Q3 launch plan", kind: "branch" },
    {
        text: "What happens at the onsite interview stage?",
        expect: "Hiring pipeline",
        kind: "branch",
    },
    {
        text: "What are the action items from the checkout postmortem?",
        expect: "Checkout outage postmortem",
        kind: "branch",
    },
    {
        text: "How is data ingested into the platform?",
        expect: "Data platform architecture",
        kind: "branch",
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Embedded {
    source: string;
    text: string;
    vector: number[];
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        na += a[i]! * a[i]!;
        nb += b[i]! * b[i]!;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function chunkStrings(markdown: string): Promise<string[]> {
    const chunks = await chunkDocument(
        [{ pageNumber: 1, textBlocks: [markdown], tables: [] }],
        PIPELINE_CHUNKING
    );
    return prepareForEmbedding(chunks);
}

interface Metrics {
    recallAt1: number;
    recallAt3: number;
    mrr: number;
    byKind: Record<Query["kind"], { recallAt1: number; n: number }>;
    /** Rank of the wanted map per query, 1-based; Infinity when absent from top 10. */
    ranks: { query: string; rank: number; top: string }[];
}

function evaluate(corpus: Embedded[], queryVectors: Map<string, number[]>): Metrics {
    const ranks: Metrics["ranks"] = [];
    const byKind: Metrics["byKind"] = {
        label: { recallAt1: 0, n: 0 },
        question: { recallAt1: 0, n: 0 },
        branch: { recallAt1: 0, n: 0 },
    };
    let hit1 = 0;
    let hit3 = 0;
    let rr = 0;
    for (const q of QUERIES) {
        const qv = queryVectors.get(q.text)!;
        // Rank *sources*, not chunks: the best chunk of each source decides,
        // which is how the ensemble's citations read to a person.
        const best = new Map<string, number>();
        for (const item of corpus) {
            const s = cosine(qv, item.vector);
            if ((best.get(item.source) ?? -Infinity) < s) best.set(item.source, s);
        }
        const ordered = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
        const rank = ordered.indexOf(q.expect) + 1;
        ranks.push({ query: q.text, rank: rank > 0 ? rank : Infinity, top: ordered[0] ?? "" });
        byKind[q.kind].n += 1;
        if (rank === 1) {
            hit1 += 1;
            byKind[q.kind].recallAt1 += 1;
        }
        if (rank >= 1 && rank <= 3) hit3 += 1;
        if (rank >= 1) rr += 1 / rank;
    }
    for (const kind of Object.keys(byKind) as Query["kind"][]) {
        byKind[kind].recallAt1 = byKind[kind].n ? byKind[kind].recallAt1 / byKind[kind].n : 0;
    }
    return {
        recallAt1: hit1 / QUERIES.length,
        recallAt3: hit3 / QUERIES.length,
        mrr: rr / QUERIES.length,
        byKind,
        ranks,
    };
}

function report(label: string, m: Metrics): void {
    const misses = m.ranks
        .filter(r => r.rank !== 1)
        .map(r => `    "${r.query}" → ${r.top} (rank ${r.rank})`);
    console.log(
        [
            `[mindmap-embedding-quality] ${label}`,
            `  recall@1 ${m.recallAt1.toFixed(2)}  recall@3 ${m.recallAt3.toFixed(2)}  MRR ${m.mrr.toFixed(2)}`,
            `  by kind: label ${m.byKind.label.recallAt1.toFixed(2)} (${m.byKind.label.n}), ` +
                `question ${m.byKind.question.recallAt1.toFixed(2)} (${m.byKind.question.n}), ` +
                `branch ${m.byKind.branch.recallAt1.toFixed(2)} (${m.byKind.branch.n})`,
            ...(misses.length ? ["  not first:", ...misses] : ["  every query put its map first"]),
        ].join("\n")
    );
}

// ---------------------------------------------------------------------------
// The eval
// ---------------------------------------------------------------------------

describeWithKey("published mindmaps are findable by embedding", () => {
    jest.setTimeout(120_000);

    let embed: (texts: string[]) => Promise<number[][]>;
    let queryVectors: Map<string, number[]>;
    let decoyCorpus: Embedded[];

    beforeAll(async () => {
        configureCompanyEmbeddingDefaults({
            embeddingIndexKey: indexKey,
            openAIApiKey: apiKey,
            openAIBaseUrl: baseUrl,
        });
        const index = resolveEmbeddingIndex(indexKey);
        const model = createEmbeddingModel(index);
        embed = async texts =>
            (await model.embedDocuments?.(texts)) ??
            Promise.all(texts.map(t => model.embedQuery(t)));
        console.log(
            `[mindmap-embedding-quality] index ${index.indexKey} (${index.model}, ${index.dimension}d)`
        );

        const qv = await embed(QUERIES.map(q => q.text));
        queryVectors = new Map(QUERIES.map((q, i) => [q.text, qv[i]!]));

        decoyCorpus = [];
        for (const decoy of DECOYS) {
            const strings = await chunkStrings(`# ${decoy.title}\n\n${decoy.text}`);
            const vectors = await embed(strings);
            strings.forEach((text, i) =>
                decoyCorpus.push({ source: decoy.title, text, vector: vectors[i]! })
            );
        }
    });

    async function corpusFor(sections: boolean): Promise<Embedded[]> {
        const items: Embedded[] = [...decoyCorpus];
        for (const doc of MAPS) {
            const strings = await chunkStrings(toMarkdownOutline(doc, { sections }));
            const vectors = await embed(strings);
            strings.forEach((text, i) =>
                items.push({ source: doc.title, text, vector: vectors[i]! })
            );
        }
        return items;
    }

    it("puts the right map first for labels, questions and branch queries (sectioned outline)", async () => {
        const metrics = evaluate(await corpusFor(true), queryVectors);
        report("sectioned outline (what the publish route renders)", metrics);
        // Labels are near-verbatim: a miss here is a rendering bug.
        expect(metrics.byKind.label.recallAt1).toBeGreaterThanOrEqual(0.8);
        // Questions and branch queries compete with prose decoys that share
        // vocabulary; the bar is "usually first, always near the top".
        expect(metrics.recallAt1).toBeGreaterThanOrEqual(0.75);
        expect(metrics.recallAt3).toBeGreaterThanOrEqual(0.9);
        expect(metrics.mrr).toBeGreaterThanOrEqual(0.8);
    });

    it("the sectioned outline is at least as findable as the plain one", async () => {
        const plain = evaluate(await corpusFor(false), queryVectors);
        report("plain outline (the download export)", plain);
        const sectioned = evaluate(await corpusFor(true), queryVectors);
        // A regression of one query is noise between two renderings of the
        // same map; a larger gap means the sections are hurting.
        expect(sectioned.mrr).toBeGreaterThanOrEqual(plain.mrr - 1 / QUERIES.length);
    });

    it("a large map still answers branch questions after it is split into chunks", async () => {
        // Twelve branches of twenty-five leaves: well past one chunk.
        const big: Record<string, Record<string, null>> = {};
        const topics = [
            "Payments",
            "Search",
            "Notifications",
            "Onboarding",
            "Reporting",
            "Permissions",
            "Integrations",
            "Mobile",
            "Exports",
            "Audit log",
            "Localisation",
            "Performance",
        ];
        for (const topic of topics) {
            const leaves: Record<string, null> = {};
            for (let l = 0; l < 25; l++)
                leaves[`${topic} task ${l + 1}: refine the ${topic.toLowerCase()} flow`] = null;
            big[topic] = leaves;
        }
        big.Permissions!["Row-level security on the audit table"] = null;
        const doc = treeDoc("Platform backlog", { "Platform backlog": big });
        const strings = await chunkStrings(toMarkdownOutline(doc, { sections: true }));
        expect(strings.length).toBeGreaterThan(6);
        const vectors = await embed(strings);
        const corpus = strings.map((text, i) => ({
            source: "Platform backlog",
            text,
            vector: vectors[i]!,
        }));

        const [qv] = await embed(["Which backlog item covers row-level security?"]);
        const ordered = corpus
            .map(c => ({ c, s: cosine(qv!, c.vector) }))
            .sort((a, b) => b.s - a.s);
        const top = ordered[0]!.c.text;
        console.log(
            `[mindmap-embedding-quality] big map: ${strings.length} chunks; top chunk section = ${top.split("\n")[0]}`
        );
        // The chunk that wins carries the branch it came from, so the answer
        // can say "Permissions" and not just "Platform backlog".
        expect(top).toMatch(/^Section: Platform backlog > Permissions/);
        expect(top).toContain("Row-level security");
    });
});
