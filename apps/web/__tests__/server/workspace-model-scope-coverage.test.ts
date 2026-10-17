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

/** Calls that resolve a chat model or read the chat configuration it comes from. */
const CHAT_CALL =
    /\b(resolveConfiguredChatModel|resolveConfiguredChatRoute|resolveChatModel|resolveChatRoute|generateStructured|invokeToolStructured|invokeStructured|getConfiguredPublicChatConfig|getPublicChatConfig|getChatModelsConfig|describeChatError)\s*\(/;

type Coverage =
    /** Runs only inside these entry points, each of which enters the workspace's scope. */
    | { scopedBy: readonly string[]; note: string }
    /** Deliberately resolves without a workspace scope. */
    | { unscoped: string }
    /** The resolver itself, or the app's thin wrapper over it: every caller is listed on its own. */
    | { library: string };

const API = "apps/web/src/app/api";
const JOBS = "apps/web/src/server/inngest/functions";

const QA_ROUTES = [
    `${API}/agents/documentQ&A/AIChat/query/route.ts`,
    `${API}/agents/documentQ&A/AIQuery/route.ts`,
    `${API}/agents/documentQ&A/AIQueryRLM/route.ts`,
];
const MARKETING_RUN = `${API}/marketing-pipeline/route.ts`;
const MARKETING_EVALUATE = `${API}/marketing-pipeline/evaluate/route.ts`;
const MARKETING_REFINE = `${API}/marketing-pipeline/refine/route.ts`;
/** Every route that drafts an email template (generateTemplate / prepareEmailCampaign). */
const EMAIL_DRAFTS = [
    `${API}/email-pipeline/generate/route.ts`,
    `${API}/email-campaigns/route.ts`,
    `${API}/email-campaigns/[campaignId]/versions/route.ts`,
    `${API}/distribution/outreach/route.ts`,
    `${API}/prospects/outreach/route.ts`,
];
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
    self(`${API}/agents/documentQ&A/AIQuery/route.ts`, "POST body after auth"),
    self(`${API}/agents/documentQ&A/AIQueryRLM/route.ts`, "POST body after auth"),
    self(`${API}/agents/documentQ&A/AskMyNotes/route.ts`, "POST body after auth"),
    [
        "apps/web/src/app/api/agents/documentQ&A/services/webSearchAgent.ts",
        { scopedBy: QA_ROUTES, note: "performWebSearch from the Q&A routes" },
    ],
    self(
        `${API}/config/ai-models/route.ts`,
        "GET: the picker's routes for the caller's workspace; signed out gets the deployment's"
    ),
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
]);

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
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

const callSites = SCANNED.flatMap(dir => walk(path.join(ROOT, dir)))
    .filter(file => CHAT_CALL.test(stripComments(fs.readFileSync(file, "utf8"))))
    .map(file => path.relative(ROOT, file).split(path.sep).join("/"))
    .sort();

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
