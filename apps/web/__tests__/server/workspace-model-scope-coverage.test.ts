/**
 * Every chat call made for a workspace runs under that workspace's models.
 *
 * A workspace that brings its own endpoint expects all of its work — Ask,
 * drafting, meetings, notes, Studio tools, background jobs — to go there and
 * none to the deployment's models. Chat resolution reads the scope entered by
 * `withWorkspaceChatModels` (~/server/workspace-models/scope), so the
 * guarantee is only as good as the entry points that enter it.
 *
 * This test scans the source for the calls that resolve or describe a chat
 * model and fails on any file not recorded in `COVERAGE` below. A new call
 * site therefore fails here until someone records how it is scoped: which
 * entry points wrap it (each must call `withWorkspaceChatModels`), or why it
 * deliberately is not. Entries must stay honest: a recorded file that no
 * longer calls a model, or an entry point that no longer enters the scope,
 * also fails.
 *
 * `COVERAGE` only checks the entry points someone thought to list, so a
 * second check works from the other end: it follows the import graph back
 * from every call site to every entry point (route handler, page, layout,
 * server action, Inngest function, worker module). An entry point that can
 * reach a call site must enter the scope itself, or be recorded in
 * `NO_MODEL_CALL` with the reason it never calls a model at runtime. Imports
 * over-approximate calls — a barrel import reaches every module behind it —
 * which is why the allowlist exists; its reasons are checked against what the
 * handler actually runs.
 *
 * Two traps the notes below avoid:
 * - An Inngest `step.run` body does NOT inherit the handler's async context
 *   (inngest 3.x runs it from its own execution loop), so jobs enter the scope
 *   inside the step, not around the handler.
 * - Next's `after()` binds the caller's async context (AsyncLocalStorage.bind),
 *   so post-response work queued inside a scope keeps it.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");

const SCANNED = [
    "apps/web/src",
    "apps/worker/src",
    "pipelines/src",
    ...fs
        .readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => `packages/${entry.name}/src`),
];

/**
 * Calls that resolve a chat model or read the chat configuration it comes
 * from — and `resolveAuxiliaryModel`, which picks the model for the AI that
 * runs during document ingestion (table summaries, page image descriptions,
 * entity extraction) from the same scope.
 */
const CHAT_CALL =
    /\b(resolveConfiguredChatModel|resolveConfiguredChatRoute|resolveChatModel|resolveChatRoute|generateStructured|invokeToolStructured|invokeStructured|getConfiguredPublicChatConfig|getPublicChatConfig|getChatModelsConfig|describeChatError|resolveAuxiliaryModel)\s*\(/;

type Coverage =
    /** Runs only inside these entry points, each of which enters the workspace's scope. */
    | { scopedBy: readonly string[]; note: string }
    /** Deliberately resolves without a workspace scope. */
    | { unscoped: string }
    /** The resolver itself, or the app's thin wrapper over it: every caller is listed on its own. */
    | { library: string };

const API = "apps/web/src/app/api";
const JOBS = "apps/web/src/server/inngest/functions";

const MARKETING_RUN = `${API}/marketing-pipeline/route.ts`;
const MARKETING_EVALUATE = `${API}/marketing-pipeline/evaluate/route.ts`;
const MARKETING_REFINE = `${API}/marketing-pipeline/refine/route.ts`;
/** Every route that drafts an email template (generateTemplate / prepareEmailCampaign). */
const EMAIL_DRAFTS = [
    `${API}/email-pipeline/generate/route.ts`,
    `${API}/email-pipeline/send/route.ts`,
    `${API}/email-campaigns/route.ts`,
    `${API}/email-campaigns/[campaignId]/versions/route.ts`,
    `${API}/email-campaign-runs/route.ts`,
    `${API}/distribution/outreach/route.ts`,
    `${API}/prospects/outreach/route.ts`,
];
/** The worker's outbox handlers for source.version.created (extract) and evidence.version.extracted (index). */
const INGESTION = "apps/worker/src/ports/ingestion.ts";
const OCR_BENCHMARK = `${API}/ocr/benchmark/route.ts`;
const CLIENT_PROSPECTOR_JOB = `${JOBS}/clientProspector.ts`;
const DISTRIBUTION_JOB = `${JOBS}/distributionRun.ts`;
const TREND_SEARCH_JOB = `${JOBS}/trendSearch.ts`;

const self = (file: string, note: string): [string, Coverage] => [file, { scopedBy: [file], note }];

const COVERAGE: Record<string, Coverage> = Object.fromEntries<Coverage>([
    // --- Ask / chat -------------------------------------------------------
    self(
        `${API}/agents/documentQ&A/AIChat/query/route.ts`,
        "POST: answer() runs in the caller's workspace scope, the streamed body included"
    ),
    self(`${API}/agents/documentQ&A/AskMyNotes/route.ts`, "POST body after auth"),
    self(
        `${API}/config/ai-models/route.ts`,
        "GET: the picker's routes for the caller's workspace; signed out gets the deployment's"
    ),
    [
        "apps/web/src/server/chat-source-data.ts",
        {
            scopedBy: [`${API}/agents/documentQ&A/AIChat/query/route.ts`],
            note: "ask_each's per-source reads, resolved during the answer's tool loop",
        },
    ],
    [
        "apps/web/src/server/ask-starters/index.ts",
        { scopedBy: [`${API}/ask/starters/route.ts`], note: "GET /api/ask/starters" },
    ],
    [
        "apps/web/src/server/assistant-conversations/follow-up-model.ts",
        {
            scopedBy: [`${API}/mcp/route.ts`],
            note: "save_conversation over MCP; the follow-up runs in after(), which keeps the scope",
        },
    ],

    // --- Predictive analysis ----------------------------------------------
    ...[
        "apps/web/src/app/api/agents/predictive-document-analysis/services/analysisEngine.ts",
        "apps/web/src/app/api/agents/predictive-document-analysis/services/referenceExtractor.ts",
    ].map((file): [string, Coverage] => [
        file,
        {
            scopedBy: [
                `${API}/agents/predictive-document-analysis/route.ts`,
                `${JOBS}/predictiveAnalysis.ts`,
            ],
            note: "route POST; the job's run-analysis step with the document's company",
        },
    ]),

    // --- Document drafting ------------------------------------------------
    self(`${API}/document-generator/generate/route.ts`, "POST body after auth"),
    self(`${API}/document-generator/grammar/route.ts`, "POST body after auth"),
    self(`${API}/document-generator/initialize/route.ts`, "POST body after auth"),
    self(
        `${API}/document-generator/legal-chat/route.ts`,
        "POST: legalChat() in scope, its catch too, so failures are worded for the right endpoint"
    ),
    self(`${API}/document-generator/outline/route.ts`, "POST body after auth"),

    // --- Notes, meetings, company profile, Vantage --------------------------
    [
        "apps/web/src/server/notes/ai-capture.ts",
        { scopedBy: [`${API}/notes/ai-capture/route.ts`], note: "POST body after auth" },
    ],
    [
        "apps/web/src/server/collab/chat.ts",
        {
            scopedBy: ["apps/web/src/server/collab/runtime.ts"],
            note: "each local meeting turn runs under the meeting row's company (workspaceLocalRuntime)",
        },
    ],
    self(
        "apps/web/src/server/company-profile/service.ts",
        "every build runs in after(); each callback enters the workspace itself"
    ),
    [
        "apps/web/src/server/vantage/service.ts",
        {
            scopedBy: [`${API}/vantage/agendas/route.ts`],
            note: "POST prepareWeek; overview and triage resolve no model",
        },
    ],
    [
        "apps/web/src/lib/llm/generate.ts",
        {
            scopedBy: [
                `${API}/ask/starters/route.ts`,
                "apps/web/src/server/company-profile/service.ts",
                "apps/worker/src/ports/projection.ts",
            ],
            note: "generateStructured: ask starters, profile builds, the worker's projection",
        },
    ],
    self(
        "apps/worker/src/ports/projection.ts",
        "outbox evidence.version.indexed: refreshForDocument under the event's company"
    ),

    // --- Background jobs --------------------------------------------------
    [
        "apps/web/src/server/founder-weekly-review/generation-adapter.ts",
        { scopedBy: [`${JOBS}/founderWeeklyReview.ts`], note: "generation job, step generate" },
    ],
    self(`${JOBS}/repoExplainerJob.ts`, "step explain, under the event's company"),

    // --- Document ingestion (resolveAuxiliaryModel) ---------------------------
    [
        "packages/conversion/src/ocr-processing/chunker.ts",
        {
            scopedBy: [INGESTION],
            note: "table summaries while chunking, in the index stage (chunkPages); nothing else chunks",
        },
    ],
    [
        "packages/conversion/src/ocr-processing/enrichment.ts",
        {
            scopedBy: [INGESTION, OCR_BENCHMARK],
            note: "page image descriptions in normalizeDocument: the extract stage; the benchmark pins the deployment's",
        },
    ],
    [
        "packages/llm/src/providers/ner/llm.ts",
        {
            scopedBy: [INGESTION],
            note: "entity extraction, the index stage's step F when ENABLE_ENTITY_EXTRACTION is on",
        },
    ],

    // --- Studio tools (feature packages + pipelines) ------------------------
    [
        "packages/tools/src/llm.ts",
        {
            scopedBy: [MARKETING_RUN, MARKETING_EVALUATE, ...EMAIL_DRAFTS],
            note: "invokeToolStructured via brand-voice, claim-evidence, company-context, content-scoring, persona",
        },
    ],
    [
        "packages/tools/src/brand-voice/index.ts",
        { scopedBy: [MARKETING_RUN, ...EMAIL_DRAFTS], note: "extractBrandVoice" },
    ],
    [
        "packages/tools/src/claim-evidence/index.ts",
        { scopedBy: [MARKETING_RUN], note: "checkClaimSources in the marketing run" },
    ],
    [
        "packages/tools/src/company-context/models.ts",
        { scopedBy: [MARKETING_RUN, ...EMAIL_DRAFTS], note: "extractCompanyDNA" },
    ],
    [
        "packages/tools/src/content-scoring/index.ts",
        {
            scopedBy: [MARKETING_RUN, MARKETING_EVALUATE],
            note: "rankVariants/validatePostQuality in the run; scorePost in evaluate",
        },
    ],
    [
        "packages/tools/src/persona/index.ts",
        { scopedBy: [MARKETING_RUN], note: "extractTargetPersona in the marketing run" },
    ],
    [
        "packages/tools/src/place-search/geocode.ts",
        {
            scopedBy: [CLIENT_PROSPECTOR_JOB, DISTRIBUTION_JOB],
            note: "client-prospector run-pipeline step; distribution searchPlaces in the enrich step",
        },
    ],
    [
        "packages/tools/src/place-search/planner.ts",
        { scopedBy: [CLIENT_PROSPECTOR_JOB], note: "client-prospector run-pipeline step" },
    ],
    [
        "pipelines/src/client-prospector/scorer.ts",
        { scopedBy: [CLIENT_PROSPECTOR_JOB], note: "run-pipeline step" },
    ],
    [
        "pipelines/src/distribution/plan.ts",
        { scopedBy: [DISTRIBUTION_JOB], note: "prepareRun in the prepare step" },
    ],
    [
        "pipelines/src/distribution/ports.ts",
        {
            scopedBy: [DISTRIBUTION_JOB],
            note: "createDefaultPorts resolves at creation; ports are built inside the prepare/enrich steps",
        },
    ],
    [
        "pipelines/src/email/models.ts",
        { scopedBy: EMAIL_DRAFTS, note: "generateTemplate / reviewTemplate" },
    ],
    [
        "pipelines/src/marketing/models.ts",
        {
            scopedBy: [MARKETING_RUN, MARKETING_REFINE],
            note: "runMarketingPipeline (SSE producer built in scope); refineContent",
        },
    ],
    [
        "pipelines/src/proposals/ports.ts",
        {
            scopedBy: ["apps/web/src/server/proposals/executor.ts", `${JOBS}/proposalsRun.ts`],
            note: "inline runs in after() (executor); worker runs in the execute step",
        },
    ],
    [
        "pipelines/src/scenarios/model.ts",
        {
            scopedBy: [
                "apps/web/src/server/scenarios/executor.ts",
                `${JOBS}/scenarioRun.ts`,
                "apps/web/src/server/scenarios/service.ts",
            ],
            note: "inline runs scope each unit in driveRun (after()); the worker scopes inside each unit step; interviews scope the call in askScenario",
        },
    ],
    [
        "pipelines/src/repo-explainer/llm.ts",
        { scopedBy: [`${API}/repo-explainer/route.ts`], note: "POST body after auth" },
    ],
    ...[
        "pipelines/src/trend-search/query-planner.ts",
        "pipelines/src/trend-search/synthesizer.ts",
    ].map((file): [string, Coverage] => [
        file,
        {
            scopedBy: [TREND_SEARCH_JOB, MARKETING_RUN],
            note: "trend-search run-pipeline step; the marketing run's research stage",
        },
    ]),

    // --- Deliberately unscoped ----------------------------------------------
    [
        "apps/web/src/server/settings/models.ts",
        { unscoped: "Settings › Models shows the deployment's default models" },
    ],
    [
        "apps/web/src/server/workspace-models/probe.ts",
        { unscoped: "tests a candidate endpoint by passing its own config; never reads a scope" },
    ],

    // --- The resolver ---------------------------------------------------------
    [
        "apps/web/src/lib/models.ts",
        { library: "app wrapper that installs the deployment config before resolving" },
    ],
    [
        "packages/llm/src/chat-model-factory.ts",
        { library: "the resolver; reads the scope in getChatModelsConfig" },
    ],
    ["packages/llm/src/public-config.ts", { library: "public route view over the resolver" }],
    [
        "packages/llm/src/auxiliary-model.ts",
        {
            library:
                "picks the ingestion model from the scope; its callers are listed on their own",
        },
    ],
]);

// --- Entry points that reach a call site but never call a model -------------

const PROPOSALS = `${API}/proposals`;
const PROSPECTS = `${API}/prospects`;

/** Proposals routes that start a run; every model call happens inside the run. */
const PROPOSAL_RUN_STARTERS = [
    `${PROPOSALS}/applications/route.ts`,
    `${PROPOSALS}/applications/[id]/draft/route.ts`,
    `${PROPOSALS}/applications/[id]/extract/route.ts`,
    `${PROPOSALS}/applications/[id]/review/route.ts`,
    `${PROPOSALS}/applications/[id]/sections/[sectionId]/rewrite/route.ts`,
    `${PROPOSALS}/funders/search/route.ts`,
];
/** Proposals routes that only read and edit rows (export also uploads the rendered file). */
const PROPOSAL_ROWS = [
    `${PROPOSALS}/applications/[id]/route.ts`,
    `${PROPOSALS}/applications/[id]/export/route.ts`,
    `${PROPOSALS}/applications/[id]/markdown/route.ts`,
    `${PROPOSALS}/applications/[id]/sections/route.ts`,
    `${PROPOSALS}/applications/[id]/sections/[sectionId]/route.ts`,
    `${PROPOSALS}/applications/[id]/sections/[sectionId]/library/route.ts`,
    `${PROPOSALS}/counts/route.ts`,
    `${PROPOSALS}/funders/route.ts`,
    `${PROPOSALS}/funders/[id]/route.ts`,
    `${PROPOSALS}/home/route.ts`,
    `${PROPOSALS}/library/route.ts`,
    `${PROPOSALS}/library/[id]/route.ts`,
    `${PROPOSALS}/runs/route.ts`,
    `${PROPOSALS}/runs/[id]/route.ts`,
    `${PROPOSALS}/sources/route.ts`,
];
/** Prospects routes over ~/server/prospects/service other than outreach. */
const PROSPECT_ROWS = [
    `${PROSPECTS}/companies/route.ts`,
    `${PROSPECTS}/companies/[id]/route.ts`,
    `${PROSPECTS}/companies/exclude/route.ts`,
    `${PROSPECTS}/deals/route.ts`,
    `${PROSPECTS}/deals/[id]/route.ts`,
    `${PROSPECTS}/home/route.ts`,
    `${PROSPECTS}/people/route.ts`,
    `${PROSPECTS}/runs/[id]/route.ts`,
    `${PROSPECTS}/runs/[id]/stop/route.ts`,
    `${PROSPECTS}/segments/route.ts`,
    `${PROSPECTS}/segments/[id]/route.ts`,
    `${PROSPECTS}/segments/[id]/confirm/route.ts`,
    `${PROSPECTS}/segments/[id]/derive/route.ts`,
    `${PROSPECTS}/sources/route.ts`,
    `${PROSPECTS}/sources/[id]/route.ts`,
];

/**
 * Entry points whose imports reach a chat call site but whose handlers never
 * call a model, each with the reason. The reason must hold for what the
 * handler runs — inline, through a promise it does not await, in after(), or
 * in a pipeline function it calls — not merely for what it imports. A route
 * that only queues an Inngest job belongs here; the job enters the scope in
 * its own step and is checked on its own.
 */
const NO_MODEL_CALL: Record<string, string> = {
    ...Object.fromEntries(
        PROPOSAL_RUN_STARTERS.map(file => [
            file,
            "model work only inside startProposalRun: executor enters the scope in after(), the worker in proposalsRun's execute step",
        ])
    ),
    ...Object.fromEntries(
        PROPOSAL_ROWS.map(file => [
            file,
            "reads and edits proposal rows; the service reaches the pipeline's ports only through startProposalRun, never called here",
        ])
    ),
    ...Object.fromEntries(
        PROSPECT_ROWS.map(file => [
            file,
            "reads and edits prospect rows or answers 409; the service reaches the email pipeline only for draftOutreach (prospects/outreach)",
        ])
    ),
    [`${API}/client-prospector/route.ts`]:
        "POST only queues client-prospector/run.requested (the job scopes run-pipeline); the barrel import is for its input schema",
    [`${API}/trend-search/route.ts`]:
        "POST only queues trend-search/run.requested (the job scopes run-pipeline); the barrel import is for its input schema",
    [`${API}/distribution/runs/route.ts`]:
        "sample runs use fixture ports (scripted model, built plan); live runs queue distribution/run.requested, whose steps scope",
    [`${PROSPECTS}/runs/route.ts`]:
        "sample and keyless runs use fixture or keyless ports (no model); live runs queue distribution/run.requested, whose steps scope",
    [`${API}/company/onboarding/route.ts`]:
        "saves profile facts; the reassembly it asks for enters the scope itself in company-profile/service's after()",
    [`${API}/document-generator/research/route.ts`]:
        "takes getEmbeddings from the Q&A services barrel; Exa, arXiv and retrieval only, no chat model",
    [`${API}/email-campaigns/[campaignId]/route.ts`]: "getCampaign reads rows",
    [`${API}/email-campaigns/[campaignId]/approve/route.ts`]:
        "approveEmailCampaign records a human approval of an existing version; nothing is generated",
    [`${API}/email-campaigns/[campaignId]/send/route.ts`]:
        "dispatchEmailCampaign delivers an approved version; nothing is generated",
    [`${API}/email-pipeline/unsubscribe/[token]/route.ts`]:
        "verifies an unsubscribe token and records a suppression",
    [`${API}/marketing-pipeline/publish/route.ts`]:
        "posts text that is already written and marks history; the marketing barrel is imported for its platform enum",
    [`${API}/repo-explainer/publish/route.ts`]:
        "renders a finished explanation to markdown and uploads it with the repo-explainer barrel's pure helpers",
    [`${API}/repo-workspaces/route.ts`]:
        "parseGitHubUrl from the repo-explainer barrel; queues repo-workspace/sync.requested, which calls no model",
    [`${API}/vantage/overview/route.ts`]:
        "loadOverview reads rows; only prepareWeek (vantage/agendas) resolves a model",
    [`${API}/vantage/triage/route.ts`]:
        "loadTriage reads rows; only prepareWeek (vantage/agendas) resolves a model",
};

/**
 * Composition roots: modules that import call-site modules at boot only to
 * configure them (`configureVlmEnrichment` lives beside the image-description
 * call; the engine barrels re-export the ingestion pipeline next to the outbox
 * store). The walk does not climb past them — otherwise every module that
 * opens the database would "reach" ingestion — and each must name none of
 * the functions that run ingestion (INGESTION_RUNNERS), checked below.
 */
const COMPOSITION_ROOTS: Record<string, string> = {
    "apps/web/src/server/engine.ts":
        "the app's composition root: createEngine plus configure* calls (entity extraction from the indexing barrel); runs nothing",
    "packages/engine/src/engine.ts":
        "createEngine: configureVlmEnrichment, configureAuxiliaryOpenAI and the other slots; runs nothing",
};

/** Calls that run ingestion (or a stage of it) rather than configure it. */
const INGESTION_RUNNERS =
    /\b(runExtractionStage|runIndexingStage|runDocIngestionTool|normalizeDocument|chunkPages|chunkDocument|enrichPageWithVlm|extractAndStoreEntities|getNERProvider)\s*\(|\bnew\s+DocIngestionPipeline\b/;

// --- Source scanning ----------------------------------------------------------

/**
 * Source with comments removed and string literals kept, so a commented-out
 * call or import counts for nothing while "//" or "/*" inside a string (a URL,
 * a MIME glob) cuts nothing.
 */
function stripComments(source: string): string {
    return source.replace(
        /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        (_match: string, literal: string | undefined) => literal ?? ""
    );
}

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "dist")
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (
            /\.(ts|tsx|mts)$/.test(entry.name) &&
            !/\.(test|spec)\.[mc]?tsx?$/.test(entry.name) &&
            !entry.name.endsWith(".d.ts")
        )
            out.push(full);
    }
    return out;
}

function read(file: string): string {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/** Every scanned file (repo-relative, forward slashes) → its source without comments. */
const CODE = new Map<string, string>(
    SCANNED.flatMap(dir => walk(path.join(ROOT, dir))).map(file => [
        path.relative(ROOT, file).split(path.sep).join("/"),
        stripComments(fs.readFileSync(file, "utf8")),
    ])
);

const callSites = [...CODE]
    .filter(([, code]) => CHAT_CALL.test(code))
    .map(([file]) => file)
    .sort();

// --- The import graph -----------------------------------------------------------

/** Workspace packages by name: where each lives and what its "exports" map says. */
const PACKAGES = new Map<string, { dir: string; exports: unknown }>();
for (const dir of [
    ...fs.readdirSync(path.join(ROOT, "packages")).map(name => `packages/${name}`),
    "pipelines",
]) {
    const manifest = path.join(ROOT, dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const json = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
        name?: string;
        exports?: unknown;
    };
    if (json.name) PACKAGES.set(json.name, { dir, exports: json.exports ?? {} });
}

/** The path an "exports" value points at: a string, or the first usable condition. */
function exportTarget(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object") return null;
    const conditions = value as Record<string, unknown>;
    for (const condition of ["default", "import", "node", "require", "types"]) {
        const target = exportTarget(conditions[condition]);
        if (target) return target;
    }
    return null;
}

/** `@launchstack/<name>/<subpath>` → the repo path its "exports" map names, "./*" patterns included. */
function resolvePackage(specifier: string): string | null {
    const match = /^(@launchstack\/[^/]+)(\/.*)?$/.exec(specifier);
    const pkg = match ? PACKAGES.get(match[1]!) : undefined;
    if (!match || !pkg) return null;
    const subpath = `.${match[2] ?? ""}`;
    const exportsMap =
        typeof pkg.exports === "string"
            ? { ".": pkg.exports }
            : (pkg.exports as Record<string, unknown>);

    let target = exportTarget(exportsMap[subpath]);
    if (!target) {
        // Node picks the pattern with the longest prefix before its "*".
        let bestPrefix = -1;
        for (const [key, value] of Object.entries(exportsMap)) {
            const star = key.indexOf("*");
            if (star < 0) continue;
            const prefix = key.slice(0, star);
            const suffix = key.slice(star + 1);
            if (
                prefix.length <= bestPrefix ||
                subpath.length < prefix.length + suffix.length ||
                !subpath.startsWith(prefix) ||
                !subpath.endsWith(suffix)
            )
                continue;
            const pattern = exportTarget(value);
            if (!pattern) continue;
            bestPrefix = prefix.length;
            target = pattern.replace(
                "*",
                subpath.slice(prefix.length, subpath.length - suffix.length)
            );
        }
    }
    return target ? path.posix.join(pkg.dir, target) : null;
}

/**
 * A workspace module specifier → the scanned file it loads, else the repo
 * path it names (a stylesheet, a file outside the scan), else null.
 */
function resolveSpecifier(specifier: string, from: string): string | null {
    let base: string | null = null;
    if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(from), specifier);
    else if (specifier.startsWith("~/")) base = `apps/web/src/${specifier.slice(2)}`;
    else if (specifier.startsWith("@launchstack/")) base = resolvePackage(specifier);
    if (base === null) return null;
    const stem = base.replace(/\.(js|mjs|ts|tsx|mts)$/, "");
    for (const candidate of [
        base,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.mts`,
        `${stem}/index.ts`,
        `${stem}/index.tsx`,
    ])
        if (CODE.has(candidate)) return candidate;
    return base;
}

const isWorkspaceSpecifier = (specifier: string) => /^(\.|~\/|@launchstack\/)/.test(specifier);

/** `import type …`, `export type …`, and braces holding only `type` names load nothing. */
function isTypeOnly(typeKeyword: string | undefined, clause: string): boolean {
    if (typeKeyword) return true;
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (!braces) return false;
    const names = braces[1]!
        .split(",")
        .map(name => name.trim())
        .filter(Boolean);
    return names.length > 0 && names.every(name => name.startsWith("type "));
}

/** Every value import in `code`: static, re-export, side-effect, `import()`, `require()`. */
function valueImports(code: string): string[] {
    const out: string[] = [];
    for (const match of code.matchAll(
        /^[ \t]*(?:import|export)\s+(type\s+)?([\w$*{},\s]*?)\s*from\s*["']([^"'\n]+)["']/gm
    )) {
        if (!isTypeOnly(match[1], match[2]!)) out.push(match[3]!);
    }
    for (const match of code.matchAll(/^[ \t]*import\s*["']([^"'\n]+)["']/gm)) out.push(match[1]!);
    for (const match of code.matchAll(/\b(?:import|require)\(\s*["']([^"'\n]+)["']\s*\)/g))
        out.push(match[1]!);
    return out;
}

/** File → the scanned files that import it; plus the imports nothing could resolve. */
const importers = new Map<string, Set<string>>();
const unresolvedImports: string[] = [];
for (const [file, code] of CODE) {
    for (const specifier of valueImports(code)) {
        if (!isWorkspaceSpecifier(specifier)) continue;
        const target = resolveSpecifier(specifier, file);
        if (target === null || (!CODE.has(target) && !fs.existsSync(path.join(ROOT, target)))) {
            unresolvedImports.push(`${file}: ${specifier}`);
            continue;
        }
        if (!CODE.has(target)) continue;
        let set = importers.get(target);
        if (!set) importers.set(target, (set = new Set()));
        set.add(file);
    }
}

const WORKER = "apps/worker/src/";

/** Where work for a workspace starts: requests, pages, server actions, jobs, the worker. */
function isEntryPoint(file: string): boolean {
    return (
        /^apps\/web\/src\/app\/(?:.*\/)?(?:route|page|layout|template|default|not-found)\.tsx?$/.test(
            file
        ) ||
        /^apps\/web\/src\/app\/(?:.*\/)?actions\.tsx?$/.test(file) ||
        /^\s*["']use server["']/.test(CODE.get(file) ?? "") ||
        /^apps\/web\/src\/(?:middleware|instrumentation)\.ts$/.test(file) ||
        file.startsWith(`${JOBS}/`) ||
        file.startsWith(WORKER)
    );
}

const entersScope = (file: string) =>
    /\b(?:withWorkspaceChatModels|runWithChatModelsScope)\s*\(/.test(CODE.get(file) ?? "");

/**
 * Where reachability starts: every call site except the resolver itself
 * (packages/llm, the app's wrapper) and the files that deliberately use the
 * deployment's models — their callers are recorded on their own.
 */
const seeds = callSites.filter(file => {
    const coverage = COVERAGE[file];
    return !(coverage && ("library" in coverage || "unscoped" in coverage));
});

/**
 * Walk the graph backwards from the seeds. `toward` records, for each file
 * reached, the file it imports on the way to a seed, so a failure can print
 * the chain. A file that enters the scope covers everything it calls, and
 * nothing imports a route or a job to call it (the Inngest serve route imports
 * every job only to register it), so the walk stops at both. Worker modules
 * are entry points that import each other, so the walk continues through them.
 */
const toward = new Map<string, string | null>(seeds.map(seed => [seed, null]));
const reachedEntryPoints: string[] = [];
{
    const queue = [...seeds];
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        if (isEntryPoint(file)) reachedEntryPoints.push(file);
        if (entersScope(file) || file in COMPOSITION_ROOTS) continue;
        if (isEntryPoint(file) && !file.startsWith(WORKER)) continue;
        for (const importer of importers.get(file) ?? []) {
            if (toward.has(importer)) continue;
            toward.set(importer, file);
            queue.push(importer);
        }
    }
    reachedEntryPoints.sort();
}

function chainFrom(file: string): string {
    const chain: string[] = [];
    for (let at: string | null | undefined = file; at; at = toward.get(at)) chain.push(at);
    return chain.join("\n      -> ");
}

describe("workspace model scope coverage", () => {
    it("finds the call sites it guards", () => {
        // A broken scan would pass every other assertion vacuously.
        expect(callSites.length).toBeGreaterThan(20);
    });

    it("records how every chat call site is scoped", () => {
        const unrecorded = callSites.filter(file => !(file in COVERAGE));
        if (unrecorded.length > 0) {
            throw new Error(
                `These files resolve a chat model but are not in COVERAGE:\n  ${unrecorded.join("\n  ")}\n\n` +
                    "Wrap the entry point that reaches each one (route handler body after auth, " +
                    "Inngest step body, worker job, after() callback) in withWorkspaceChatModels, " +
                    "then record it here. If it must use the deployment's models, record why."
            );
        }
    });

    it("has no stale entries", () => {
        const stale = Object.keys(COVERAGE).filter(file => !callSites.includes(file));
        expect(stale).toEqual([]);
    });

    it("names entry points that really enter the workspace scope", () => {
        const notScoping = new Set<string>();
        for (const coverage of Object.values(COVERAGE)) {
            if (!("scopedBy" in coverage)) continue;
            for (const entry of coverage.scopedBy) {
                if (!fs.existsSync(path.join(ROOT, entry))) {
                    notScoping.add(`${entry} (missing)`);
                    continue;
                }
                if (!/\bwithWorkspaceChatModels\s*\(/.test(stripComments(read(entry))))
                    notScoping.add(entry);
            }
        }
        expect([...notScoping]).toEqual([]);
    });
});

describe("workspace model scope reachability", () => {
    it("resolves every workspace import it follows", () => {
        // An import the graph cannot follow is a blind spot, not a pass.
        expect(unresolvedImports).toEqual([]);
    });

    it("reaches the entry points it guards", () => {
        // A broken graph would pass the next assertion vacuously.
        expect(reachedEntryPoints.length).toBeGreaterThan(40);
        expect(reachedEntryPoints).toContain(`${API}/email-campaigns/route.ts`);
        // Ingestion's model calls reach the worker through the indexing barrel.
        expect(reachedEntryPoints).toContain(INGESTION);
    });

    it("finds no entry point that can reach a model outside its workspace's scope", () => {
        const leaks = reachedEntryPoints.filter(
            file => !entersScope(file) && !(file in NO_MODEL_CALL)
        );
        if (leaks.length > 0) {
            throw new Error(
                `These entry points can reach a chat call site and never enter the workspace's scope:\n\n    ${leaks
                    .map(chainFrom)
                    .join("\n\n    ")}\n\n` +
                    "If the handler can call a model at runtime (inline, in after(), through a " +
                    "pipeline or tool), wrap its body after auth in withWorkspaceChatModels. If it " +
                    "only imports the module (a barrel, a schema, a pure helper) or only queues a " +
                    "job, record it in NO_MODEL_CALL with the reason."
            );
        }
    });

    it("keeps COMPOSITION_ROOTS to modules that configure and run nothing", () => {
        const problems: string[] = [];
        for (const root of Object.keys(COMPOSITION_ROOTS)) {
            const code = CODE.get(root);
            if (code === undefined) problems.push(`${root}: missing`);
            else if (!toward.has(root))
                problems.push(`${root}: no longer on a path to a call site`);
            else if (INGESTION_RUNNERS.test(code) || CHAT_CALL.test(code))
                problems.push(
                    `${root}: runs ingestion or resolves a model, so it is an entry to scope`
                );
        }
        expect(problems).toEqual([]);
    });

    it("keeps NO_MODEL_CALL honest", () => {
        const stale = Object.keys(NO_MODEL_CALL).filter(
            file => !reachedEntryPoints.includes(file) || entersScope(file)
        );
        // Each of these no longer reaches a call site, or now enters the scope: drop it.
        expect(stale).toEqual([]);
    });
});
