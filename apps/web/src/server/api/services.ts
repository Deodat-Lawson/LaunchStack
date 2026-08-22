/**
 * The service map: what the API is made of, and which tier each part sits in.
 *
 * The route tree grew a folder at a time and reads as 130-odd peers. This
 * declares the grouping that actually exists underneath, so a new route has an
 * obvious home and a reviewer has something to check it against.
 *
 * This is a description of the API, not a router. Next.js still owns routing;
 * nothing here moves a file. It is the source of truth a lint rule, a docs
 * page, or a future physical reorganisation can be driven from — and until then
 * it is the answer to "where does this belong?".
 *
 * ## The two tiers
 *
 * A **tool** is something a founder opens and uses. It owns a job end to end
 * and has a surface in the product.
 *
 * A **platform** service is a shared capability that tools draw on. Not every
 * tool uses every platform service — knowledge and retrieval are used widely,
 * voice by a few, connectors by one today. What makes it platform is that it is
 * *available* to tools rather than being a destination of its own.
 *
 * ## The third case
 *
 * Some routes belong to no tool and no capability: health, metrics, signup,
 * workspace selection, the webhooks. They are marked `scope: "unscoped"` where
 * they legitimately run outside a workspace, which exists so nobody later
 * "fixes" a route by adding a workspace gate that would break it.
 */

export type ServiceTier = "tool" | "platform" | "system";

/**
 * Whether a service's routes resolve an active workspace.
 *
 * `workspace` — every route gates on workspace context. The default.
 * `mixed`     — mostly workspace-scoped, with named exceptions below.
 * `unscoped`  — deliberately outside a workspace, for a stated reason.
 */
export type ServiceScope = "workspace" | "mixed" | "unscoped";

export interface ServiceDefinition {
    /** Stable id. Kebab-case, and the name a route folder should eventually use. */
    id: string;
    tier: ServiceTier;
    /** What a founder would say this does. */
    summary: string;
    scope: ServiceScope;
    /** Current route folders under `src/app/api`, relative to it. */
    routes: readonly string[];
    /** The feature package behind it, when there is one. */
    feature?: string;
    /**
     * Routes that intentionally run without workspace context, and why.
     * Present only when `scope` is `mixed` or `unscoped`.
     */
    unscopedRoutes?: Readonly<Record<string, string>>;
    notes?: string;
}

// ============================================================================
// Tier 1 — tools. A founder opens these.
// ============================================================================

export const TOOL_SERVICES: readonly ServiceDefinition[] = [
    {
        id: "investor-updates",
        tier: "tool",
        summary: "Generate a cited investor update for a reporting period.",
        scope: "workspace",
        feature: "@launchstack/features/founder-weekly-review",
        routes: ["founder-weekly-reviews"],
        notes:
            "Resolves its actor through a vertical-specific resolver rather than the shared " +
            "route contract; folding that in is the reference conversion.",
    },
    {
        id: "email-campaigns",
        tier: "tool",
        summary: "Generate an email from a template, review it, and send it to a recipient list.",
        scope: "mixed",
        feature: "@launchstack/features/email-pipeline",
        routes: ["email-campaigns", "email-campaign-runs", "email-pipeline"],
        unscopedRoutes: {
            "email-pipeline/unsubscribe/[token]":
                "Recipients are not users. The company and address travel inside a signed token.",
        },
        notes:
            "One tool across three route folders today. Owns the shared route contract that " +
            "now lives in ~/server/api/context.",
    },
    {
        id: "client-prospector",
        tier: "tool",
        summary: "Find and score prospective customers in a place and category.",
        scope: "workspace",
        feature: "@launchstack/features/client-prospector",
        routes: ["client-prospector"],
        notes: "Backend and background job complete; no UI exists yet.",
    },
    {
        id: "social-marketing",
        tier: "tool",
        summary: "Draft platform-specific posts grounded in company documents.",
        scope: "workspace",
        feature: "@launchstack/features/marketing-pipeline",
        routes: ["marketing-pipeline"],
    },
    {
        id: "market-analysis",
        tier: "tool",
        summary: "Research a market question against the web and synthesise a brief.",
        scope: "workspace",
        feature: "@launchstack/features/trend-search",
        routes: ["trend-search"],
        notes: "Backend and background job complete; no UI exists yet.",
    },
    {
        id: "legal",
        tier: "tool",
        summary: "Generate legal documents from templates and redline existing ones.",
        scope: "workspace",
        feature: "@launchstack/features/legal-templates",
        routes: ["legal"],
        notes:
            "The legal-specific half of document-generator (legal-generate, legal-chat) " +
            "belongs here rather than in the general drafting tool.",
    },
    {
        id: "document-generator",
        tier: "tool",
        summary: "Draft, outline, research and export a long-form document.",
        scope: "workspace",
        routes: ["document-generator"],
        notes:
            "General-purpose drafting. Its legal-* routes are legal's; splitting them is " +
            "what makes both surfaces coherent.",
    },
    {
        id: "predictive-analysis",
        tier: "tool",
        summary: "Identify documents a set of sources implies but does not contain.",
        scope: "workspace",
        routes: ["agents/predictive-document-analysis"],
        notes: "Document-scoped today, and reachable only from a background job — no UI caller.",
    },
    {
        id: "repo-explainer",
        tier: "tool",
        summary: "Explain a code repository and diagram its architecture.",
        scope: "workspace",
        feature: "@launchstack/features/repo-explainer",
        routes: ["repo-explainer"],
    },
    {
        id: "notes",
        tier: "tool",
        summary: "Freeform notes that link to sources and to each other.",
        scope: "workspace",
        routes: ["notes"],
        notes:
            "A tool a founder opens, and also a retrieval source for chat — the one entry " +
            "that genuinely sits on the line between the tiers.",
    },
];

// ============================================================================
// Tier 2 — platform. Capabilities tools draw on. Not every tool uses every one.
// ============================================================================

export const PLATFORM_SERVICES: readonly ServiceDefinition[] = [
    {
        id: "knowledge",
        tier: "platform",
        summary: "Get sources in, and get them back out: upload, convert, index, retrieve, serve.",
        scope: "workspace",
        routes: [
            "documents",
            "files",
            "fetchDocument",
            "deleteDocument",
            "uploadDocument",
            "upload",
            "upload-local",
            "uploadthing",
            "storage",
            "ocr",
            "graph",
            "embedding-indexes",
            "Categories",
            "employer/upload",
            "updateUploadPreference",
        ],
        notes:
            "The largest and least consistent service: ten separate upload entry points, and " +
            "RPC-style routes that shadow the documents resource.",
    },
    {
        id: "retrieval",
        tier: "platform",
        summary: "Answer a question over the workspace's sources, with references.",
        scope: "workspace",
        routes: ["agents/documentQ&A", "Questions"],
        notes:
            "Route path contains a literal ampersand. Also hosts a persisted chat/task/tool " +
            "surface that has no client. `Questions/{add,fetch}` are the chat-history reads " +
            "and writes — live and tested, but named as procedures in PascalCase, so they are " +
            "the clearest rename candidates in the service.",
    },
    {
        id: "company",
        tier: "platform",
        summary: "The company's own facts: profile, extracted metadata, history.",
        scope: "workspace",
        feature: "@launchstack/features/company-metadata",
        routes: ["company", "fetchCompany", "updateCompany"],
        notes: "Read by most tools to ground generation; written by the projection worker.",
    },
    {
        id: "collab",
        tier: "platform",
        summary: "Agent personas, meetings, and the channels they run in.",
        scope: "mixed",
        routes: ["collab"],
        unscopedRoutes: {
            "collab/slack/events": "Slack webhook, authenticated by request signature.",
            "collab/hub/[...path]": "Remote agent nodes, authenticated by HMAC.",
        },
    },
    {
        id: "voice",
        tier: "platform",
        summary: "Speech to text and text to speech.",
        scope: "workspace",
        feature: "@launchstack/features/voice",
        routes: ["voice"],
        notes: "Used by a few tools rather than most — capture and narration, not core.",
    },
    {
        id: "connectors",
        tier: "platform",
        summary: "Register an external body of knowledge as a source.",
        scope: "workspace",
        feature: "@launchstack/features/connectors",
        routes: ["connectors"],
        notes: "One connector today, environment-gated.",
    },
];

// ============================================================================
// Tier 3 — system. Belongs to no tool and no capability.
// ============================================================================

export const SYSTEM_SERVICES: readonly ServiceDefinition[] = [
    {
        id: "workspace",
        tier: "system",
        summary: "Accounts, workspaces, membership, invitations.",
        scope: "mixed",
        routes: [
            "workspaces",
            "signup",
            "employerAuth",
            "employeeAuth",
            "invite-codes",
            "approveEmployees",
            "removeEmployees",
            "getAllEmployees",
            "fetchUserInfo",
        ],
        unscopedRoutes: {
            "signup/*": "Runs before a user row or membership exists.",
            workspaces: "Selecting a workspace cannot require one to already be active.",
            "workspaces/[id]/switch": "Changes which workspace is active.",
            "workspaces/slug-available": "Checked while creating a workspace.",
            "invite-codes/validate": "Checked before the caller is a member.",
            employerAuth: "Establishes the session that workspace context reads.",
            employeeAuth: "Establishes the session that workspace context reads.",
            fetchUserInfo: "User-level identity, not workspace-scoped.",
        },
    },
    {
        id: "platform-ops",
        tier: "system",
        summary: "Health, metrics, runtime configuration, and usage accounting.",
        scope: "mixed",
        routes: ["health", "metrics", "config", "credits"],
        unscopedRoutes: {
            health: "Liveness probe.",
            metrics: "Prometheus scrape, authenticated by bearer token.",
            "config/*": "Non-secret client configuration.",
            "ocr/benchmark": "CI-only benchmark.",
        },
    },
];

export const ALL_SERVICES: readonly ServiceDefinition[] = [
    ...TOOL_SERVICES,
    ...PLATFORM_SERVICES,
    ...SYSTEM_SERVICES,
];

/** Which service a route folder belongs to, or null when it is unclaimed. */
export function serviceForRoute(routePath: string): ServiceDefinition | null {
    const normalized = routePath.replace(/^\/+/, "");
    let best: ServiceDefinition | null = null;
    let bestLength = -1;
    for (const service of ALL_SERVICES) {
        for (const owned of service.routes) {
            const matches = normalized === owned || normalized.startsWith(`${owned}/`);
            // Longest prefix wins so a nested owner beats a broader one.
            if (matches && owned.length > bestLength) {
                best = service;
                bestLength = owned.length;
            }
        }
    }
    return best;
}
