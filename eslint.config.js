import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
// @ts-ignore - eslint-plugin-drizzle doesn't have type declarations
import drizzle from "eslint-plugin-drizzle";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

// Flat config REPLACES a rule's options when a later block matches the same
// file — it never merges them. Every block below that re-declares
// no-restricted-imports for an apps/web scope must therefore carry the full
// set of error-level restrictions itself; these shared pieces keep that
// composition in one place.
const chatClientImportBans = [
    {
        name: "@langchain/openai",
        importNames: ["ChatOpenAI"],
        message:
            "Resolve a route with @launchstack/core/llm instead. " +
            "ChatOpenAI belongs to openai-compatible-transport.ts alone. " +
            "(OpenAIEmbeddings is fine — embeddings are configured separately.)",
    },
    {
        name: "@langchain/anthropic",
        importNames: ["ChatAnthropic"],
        message:
            "Chat reaches one OpenAI-compatible endpoint; native provider " +
            "transports are tracked in the multi-endpoint follow-up issue.",
    },
    {
        name: "@langchain/google-genai",
        importNames: ["ChatGoogleGenerativeAI"],
        message:
            "Chat reaches one OpenAI-compatible endpoint; native provider " +
            "transports are tracked in the multi-endpoint follow-up issue.",
    },
    {
        name: "@langchain/ollama",
        importNames: ["ChatOllama"],
        message:
            "Point CHAT_BASE_URL at Ollama's OpenAI-compatible /v1 surface " +
            "instead. (OllamaEmbeddings is fine — embeddings are separate.)",
    },
];

const oldKitTombstone = {
    group: ["~/app/employer/documents/components/ui/*", "**/documents/components/ui/*"],
    message: "The base kit moved: import from ~/components/ui/<name>.",
};

// no-restricted-imports matches the raw specifier, so relative escapes from
// a route area must be banned explicitly alongside the alias forms.
const relativeReaches = area => [
    `../${area}/*`,
    `../../${area}/*`,
    `../../../${area}/*`,
    `../../../../${area}/*`,
    `../../../../../${area}/*`,
    `../../../../../../${area}/*`,
];

const deprecatedModuleWarns = [
    {
        group: ["**/_workspace/icons"],
        message:
            "Legacy icon set. Use lucide-react for general icons " +
            "and ~/components/icons/brand for brand marks.",
    },
];

const eslintConfig = [
    {
        // Flat-config patterns are anchored: without a `**/` prefix they only
        // match at the repository root. Build output and generated artifacts
        // need the prefix or every `pnpm build` floods lint with dist errors.
        ignores: [
            "**/.next/**",
            "**/node_modules/**",
            "**/dist/**",
            // Generated migration SQL + drizzle journal/snapshots.
            "**/drizzle/**",
            "**/next-env.d.ts",
            "eslint.config.js",
            "**/jest.config.mjs",
            "**/jest.config.js",
            "apps/web/public/vad/**",
            // Minified pdf.js worker, copied from node_modules at build time
            // by apps/web/scripts/copy-pdf-worker.mjs. Vendored output, not
            // source — and it is outside every tsconfig, so typed linting
            // cannot parse it anyway.
            "apps/web/public/pdf.worker.min.mjs",
            // Untyped operational scripts (repo-root scripts/, package .mjs
            // scripts): plain files run directly by node, outside every
            // tsconfig project — the type-aware parser cannot load them.
            "scripts/**",
            "**/scripts/**/*.mjs",
            ".pnpmfile.cjs",
            "prettier.config.js",
            "**/drizzle.config.ts",
            "**/vitest.config.ts",
        ],
    },
    ...compat.extends(
        "next/core-web-vitals",
        "plugin:@typescript-eslint/recommended-type-checked",
        "plugin:@typescript-eslint/stylistic-type-checked"
    ),
    {
        files: ["**/*.{js,mjs,cjs,ts,tsx}"],
        plugins: {
            "@typescript-eslint": typescriptEslint,
            drizzle,
        },

        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: true,
            },
        },

        rules: {
            "@typescript-eslint/array-type": "off",
            "@typescript-eslint/consistent-type-definitions": "off",

            "@typescript-eslint/consistent-type-imports": [
                "warn",
                {
                    prefer: "type-imports",
                    fixStyle: "inline-type-imports",
                },
            ],

            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                },
            ],

            "@typescript-eslint/require-await": "off",

            "@typescript-eslint/no-misused-promises": [
                "error",
                {
                    checksVoidReturn: {
                        attributes: false,
                    },
                },
            ],

            "drizzle/enforce-delete-with-where": [
                "error",
                {
                    drizzleObjectName: ["db", "ctx.db"],
                },
            ],

            "drizzle/enforce-update-with-where": [
                "error",
                {
                    drizzleObjectName: ["db", "ctx.db"],
                },
            ],
        },
    },
    // `services/*` is deliberately outside the pnpm workspace (see
    // pnpm-workspace.yaml), so its dependencies are never installed here and no
    // tsconfig project covers it. Type-aware linting consequently resolves
    // every import in the tree to `error` and buries it under ~440 phantom
    // no-unsafe-* violations — the reason lint has been red on main.
    //
    // Drop the type information, not the files. Each service's own CI job runs
    // `tsc --noEmit` and its test suite against its own lockfile, but none of
    // them run ESLint, so ignoring `services/**` here would leave this code
    // with no lint coverage anywhere. The syntactic rules need no type
    // information and keep working.
    {
        files: ["services/**/*.{ts,tsx,js,mjs,cjs}"],
        languageOptions: {
            parserOptions: {
                project: false,
                projectService: false,
            },
        },
        rules: typescriptEslint.configs["disable-type-checked"].rules,
    },
    // Tests and dev-harness scripts interact with jest/vitest mocks and
    // ad-hoc JSON, where the type-aware `no-unsafe-*` family is ~all noise.
    // This is a scoped RULE policy, not a bypass: every other rule (including
    // correctness rules and the boundary restrictions) still applies to
    // tests, and production code keeps the full ruleset (ADR-006).
    {
        files: [
            "**/__tests__/**/*.{ts,tsx}",
            "**/*.test.{ts,tsx}",
            "apps/web/scripts/**/*.{ts,tsx}",
            "apps/web/jest.setup.ts",
        ],
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/unbound-method": "off",
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },
    // Every chat request goes through one OpenAI-compatible transport, which
    // is the only module allowed to construct a chat client. A feature that
    // builds its own skips route resolution, declared-behavior filtering, and
    // usage normalization — and can silently borrow an unrelated API key.
    {
        files: [
            "packages/**/src/**/*.{ts,tsx}",
            "pipelines/src/**/*.{ts,tsx}",
            "apps/web/src/**/*.{ts,tsx}",
        ],
        ignores: ["packages/llm/src/openai-compatible-transport.ts"],
        rules: {
            "no-restricted-imports": ["error", { paths: chatClientImportBans }],
        },
    },

    // ── Feature-package boundaries (ADR-008) ─────────────────────────────
    // Flat config REPLACES no-restricted-imports per matching block, so each
    // scope below composes every ban that applies to it: the legacy-name ban
    // (the flat ban that replaced the facade ratchet), the framework ban, the
    // tier ban, the per-package dependency direction, and the chat-transport
    // path bans from above.
    ...(() => {
        const legacyBan = {
            group: [
                "@launchstack/core",
                "@launchstack/core/*",
                "@launchstack/protocol",
                "@launchstack/protocol/*",
                "@launchstack/application",
                "@launchstack/application/*",
                "@launchstack/adapters",
                "@launchstack/adapters/*",
                "@launchstack/features",
                "@launchstack/features/*",
                "@launchstack/search",
                "@launchstack/search/*",
            ],
            message:
                "Deleted package (ADR-008) or renamed brick " +
                "(@launchstack/search → @launchstack/retrieval). Import the " +
                "owning feature package instead: store/llm/conversion/indexing/" +
                "retrieval/orchestration/editing/collab/runtime/engine/pipelines.",
        };
        const frameworkBan = {
            group: ["next/*", "next", "@clerk/*", "react", "react-dom", "~/*"],
            message:
                "Engine packages must stay framework-agnostic: no Next, Clerk, " +
                "React, or apps/web imports below the app boundary.",
        };
        const noPipelines = {
            group: ["@launchstack/pipelines", "@launchstack/pipelines/*"],
            message:
                "Bricks must not import compositions: pipelines/* may import " +
                "packages/*, never the reverse (ADR-008).",
        };
        const only = (allowed, name) => ({
            group: [
                "engine",
                "runtime",
                "evidence",
                "store",
                "llm",
                "conversion",
                "indexing",
                "retrieval",
                "orchestration",
                "editing",
                "document-conversion-engine",
                "google-drive",
                "collab",
                "schema-generator",
                "pipelines",
                "design-tokens",
            ]
                .filter(p => !allowed.includes(p))
                .flatMap(p => [`@launchstack/${p}`, `@launchstack/${p}/*`]),
            message:
                `${name} may import only ${allowed.length ? allowed.join(", ") : "nothing"} ` +
                "(ADR-008 dependency direction).",
        });
        const noEnv = {
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message:
                        "Engine packages must not read process.env — configuration " +
                        "is injected by the composition roots (CoreConfig / configure* hooks).",
                },
            ],
        };
        const restrict = patterns => ({
            "no-restricted-imports": ["error", { paths: chatClientImportBans, patterns }],
        });
        return [
            // The flat legacy ban, everywhere.
            {
                files: ["**/*.{ts,tsx,mjs}"],
                ignores: ["**/node_modules/**", "**/dist/**"],
                rules: {
                    "no-restricted-imports": ["error", { patterns: [legacyBan] }],
                },
            },
            {
                files: ["packages/runtime/src/**/*.ts", "packages/evidence/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only([], "runtime/evidence"),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/store/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(["runtime"], "@launchstack/store"),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/llm/src/**/*.ts"],
                ignores: ["packages/llm/src/openai-compatible-transport.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(["runtime", "store"], "@launchstack/llm"),
                    ]),
                    ...noEnv,
                },
            },
            // The transport file keeps the boundary patterns but not the
            // chat-client paths ban — it IS the one allowed constructor.
            {
                files: ["packages/llm/src/openai-compatible-transport.ts"],
                rules: {
                    "no-restricted-imports": [
                        "error",
                        { patterns: [legacyBan, frameworkBan, noPipelines] },
                    ],
                    ...noEnv,
                },
            },
            {
                files: ["packages/orchestration/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(["runtime", "store"], "@launchstack/orchestration"),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/conversion/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(
                            ["runtime", "store", "llm", "orchestration"],
                            "@launchstack/conversion"
                        ),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/indexing/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(
                            ["runtime", "store", "llm", "orchestration", "conversion"],
                            "@launchstack/indexing"
                        ),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/retrieval/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        // "indexing" is here for exactly one edge: the graph
                        // algorithm's Neo4j backend reuses indexing's graph
                        // client (isNeo4jConfigured/getNeo4jSession). Indexing
                        // sits below retrieval in the DAG, so the edge is legal.
                        only(
                            ["runtime", "store", "llm", "evidence", "indexing"],
                            "@launchstack/retrieval"
                        ),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/collab/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only([], "@launchstack/collab"),
                    ]),
                    ...noEnv,
                },
            },
            // @launchstack/document-conversion-engine — the Gotenberg client (ADR-009).
            // Bottom-of-graph like collab, and unlike the editing client it
            // has no env exception: connection settings are injected by the
            // composition root.
            {
                files: ["packages/document-conversion-engine/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only([], "@launchstack/document-conversion-engine"),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/google-drive/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only([], "@launchstack/google-drive"),
                    ]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/engine/src/**/*.ts"],
                rules: {
                    ...restrict([legacyBan, frameworkBan, noPipelines]),
                    ...noEnv,
                },
            },
            {
                files: ["packages/schema-generator/src/**/*.ts"],
                rules: {
                    ...restrict([
                        legacyBan,
                        frameworkBan,
                        noPipelines,
                        only(
                            ["runtime", "conversion", "orchestration", "editing"],
                            "@launchstack/schema-generator"
                        ),
                    ]),
                },
            },
            // @launchstack/tools — shared, contract-typed capabilities the
            // verticals compose. A brick above retrieval, below pipelines; may
            // read process.env (social/web-research provider keys, inherited
            // from the features tier where these capabilities were born).
            {
                files: ["packages/tools/src/**/*.{ts,tsx}"],
                rules: restrict([
                    legacyBan,
                    frameworkBan,
                    noPipelines,
                    only(
                        ["runtime", "evidence", "store", "llm", "retrieval", "conversion"],
                        "@launchstack/tools"
                    ),
                ]),
            },
            // The transcription clients (from the voice vertical) and the adeu
            // client (from the old features tier) resolve their service
            // endpoints from the environment — the documented env exceptions
            // below the composition root (ADR-008).
            {
                files: [
                    "packages/conversion/src/transcription-service.ts",
                    "packages/conversion/src/audio-transcription/providers/**/*.ts",
                    "packages/editing/src/**/*.ts",
                ],
                rules: {
                    "no-restricted-globals": "off",
                },
            },
            // pipelines/ — the compositions tier. May import any brick; can
            // read process.env (product verticals, not engine code); must not
            // import Next / Clerk / React or apps/web.
            {
                files: ["pipelines/src/**/*.{ts,tsx}"],
                rules: restrict([
                    legacyBan,
                    {
                        group: ["next/*", "next", "@clerk/*", "react", "react-dom"],
                        message:
                            "@launchstack/pipelines must not import Next, Clerk, or React. " +
                            "Those belong in apps/web. A composition has to work in any Node host.",
                    },
                    {
                        group: ["~/*"],
                        message:
                            "@launchstack/pipelines cannot import from apps/web (~/*). " +
                            "Rewrite as a relative import inside the vertical or as a " +
                            "feature-package import.",
                    },
                ]),
            },
        ];
    })(),
    // Design-system guardrails (see apps/web/README.md). Two tiers so that
    // error- and warn-level restrictions can coexist on the same files
    // (one rule id holds one severity): hard boundaries live in the base
    // no-restricted-imports — every block that redefines it for a narrower
    // web scope repeats the wider scope's restrictions, because flat
    // config replaces rather than merges — and warn-level deprecation
    // ratchets live in the @typescript-eslint twin rule. Warn counts may
    // only go down.
    {
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                { paths: chatClientImportBans, patterns: [oldKitTombstone] },
            ],
        },
    },
    // Route areas are products: employer and employee must not reach into
    // each other. Shared pieces belong in ~/components, ~/lib, or
    // ~/app/_components. Both legs are hard errors; the one sanctioned
    // exception (the shared document workspace, rendered by both products)
    // carries an inline eslint-disable at its import site until the
    // feature gets a neutral home.
    {
        files: ["apps/web/src/app/employer/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: chatClientImportBans,
                    patterns: [
                        oldKitTombstone,
                        {
                            group: [
                                "~/app/employee/*",
                                "**/app/employee/*",
                                ...relativeReaches("employee"),
                            ],
                            message:
                                "employer must not import from the employee area; " +
                                "promote shared code to ~/components or ~/lib.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["apps/web/src/app/employee/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: chatClientImportBans,
                    patterns: [
                        oldKitTombstone,
                        {
                            group: [
                                "~/app/employer/*",
                                "**/app/employer/*",
                                "~/styles/Employer/*",
                                ...relativeReaches("employer"),
                            ],
                            message:
                                "employee must not import from the employer area; " +
                                "promote shared code to ~/components or ~/lib.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["apps/web/src/**/*.{ts,tsx}"],
        ignores: ["apps/web/src/app/employer/documents/_workspace/**"],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "warn",
                { patterns: deprecatedModuleWarns },
            ],
        },
    },
    // ADR-010: authorization is `ctx.data.can(permission)` over the membership
    // role. The retired management-role shim and the legacy global
    // `users.role` / `users.status` columns must not come back through a
    // stale branch. Error-level: the count is zero and stays zero.
    {
        files: ["apps/web/src/**/*.{ts,tsx}", "apps/web/__tests__/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "~/lib/membership-roles",
                            message:
                                "Deleted (ADR-010). Gate on ctx.data.can(permission) from ~/lib/authz/permissions.",
                        },
                    ],
                    patterns: [
                        {
                            group: ["**/lib/membership-roles"],
                            message:
                                "Deleted (ADR-010). Gate on ctx.data.can(permission) from ~/lib/authz/permissions.",
                        },
                    ],
                },
            ],
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "MemberExpression[object.name='users'][property.name=/^(role|status)$/]",
                    message:
                        "users.role / users.status are legacy and unread (ADR-010). Use the membership row: user_company_memberships.role + status.",
                },
            ],
        },
    },
    // Colors come from tokens (var(--…) / semantic Tailwind classes), not
    // hex literals in any CSS form (#rgb, #rgba, #rrggbb, #rrggbbaa).
    // Warn-level ratchet; baseline ~74 occurrences.
    {
        files: ["apps/web/src/**/*.tsx"],
        rules: {
            "no-restricted-syntax": [
                "warn",
                {
                    selector:
                        "Literal[value=/#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|[0-9a-fA-F]{3,4})\\b/]",
                    message:
                        "Use design tokens (var(--…) or semantic Tailwind classes " +
                        "like bg-panel/text-ink/border-line) instead of hex colors.",
                },
                {
                    selector:
                        "TemplateElement[value.raw=/#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|[0-9a-fA-F]{3,4})\\b/]",
                    message:
                        "Use design tokens (var(--…) or semantic Tailwind classes) " +
                        "instead of hex colors.",
                },
            ],
        },
    },
];

export default eslintConfig;
