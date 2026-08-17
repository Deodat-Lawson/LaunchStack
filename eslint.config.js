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
    {
        group: ["~/app/employer/_components/primitives", "**/_components/primitives"],
        message:
            "Deprecated inline-style primitives. Use ~/components/ui " +
            "(shadcn base kit on the design tokens) instead.",
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
    // @launchstack/core is the published compatibility facade (ADR-002):
    // every file under its src is a re-export stub over @launchstack/adapters
    // and friends (scripts/ci/check-core-facade.mjs enforces the stub shape).
    // The import bans stay so a stub can never quietly grow a framework
    // dependency, and the process ban stays — stubs read no env.
    {
        files: ["packages/core/src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["next/*", "next", "@clerk/*", "react", "react-dom"],
                            message:
                                "@launchstack/core must stay framework-agnostic. " +
                                "No Next, Clerk, React, or UI libraries in core.",
                        },
                        {
                            group: ["~/*", "@launchstack/features", "@launchstack/features/*"],
                            message:
                                "@launchstack/core cannot depend on apps/web (~/*) " +
                                "or @launchstack/features. Features depend on core, " +
                                "not the other way around.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message:
                        "@launchstack/core must not read process.env. " +
                        "Accept runtime config through CoreConfig / configure* hooks.",
                },
            ],
        },
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
    // Layered engine packages (ADR-002). Dependency direction is strict:
    //   protocol ← evidence ← application ← adapters ← core/apps/services.
    // Each layer may import only the layers to its left; nothing below the
    // app boundary may import Next, Clerk, React, apps/web (~/*), or
    // @launchstack/features.
    {
        files: ["packages/protocol/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@launchstack/*",
                                "~/*",
                                "next",
                                "next/*",
                                "@clerk/*",
                                "react",
                                "node:*",
                            ],
                            message:
                                "@launchstack/protocol is contracts only: zod and " +
                                "nothing else — no other workspace package, no " +
                                "Node built-ins, no frameworks.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message: "@launchstack/protocol must not read the environment.",
                },
            ],
        },
    },
    {
        files: ["packages/evidence/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@launchstack/core",
                                "@launchstack/core/*",
                                "@launchstack/application",
                                "@launchstack/application/*",
                                "@launchstack/adapters",
                                "@launchstack/adapters/*",
                                "@launchstack/features",
                                "@launchstack/features/*",
                                "~/*",
                                "next",
                                "next/*",
                                "@clerk/*",
                                "react",
                                "node:*",
                            ],
                            message:
                                "@launchstack/evidence is pure domain logic: it may " +
                                "import @launchstack/protocol and nothing else.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message: "@launchstack/evidence must not read the environment.",
                },
            ],
        },
    },
    {
        files: ["packages/application/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@launchstack/core",
                                "@launchstack/core/*",
                                "@launchstack/adapters",
                                "@launchstack/adapters/*",
                                "@launchstack/features",
                                "@launchstack/features/*",
                                "~/*",
                                "next",
                                "next/*",
                                "@clerk/*",
                                "react",
                                "drizzle-orm",
                                "drizzle-orm/*",
                                "postgres",
                            ],
                            message:
                                "@launchstack/application holds use cases and ports " +
                                "only. It may import protocol + evidence; database " +
                                "and framework code belongs in adapters/apps.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message:
                        "@launchstack/application must not read the environment — " +
                        "configuration arrives through injected ports.",
                },
            ],
        },
    },
    {
        files: ["packages/adapters/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@launchstack/features",
                                "@launchstack/features/*",
                                "~/*",
                                "next",
                                "next/*",
                                "@clerk/*",
                                "react",
                                "react-dom",
                            ],
                            message:
                                "@launchstack/adapters implements ports over " +
                                "infrastructure. It must stay host-agnostic: no " +
                                "Next/Clerk/React, no apps/web, no features.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message:
                        "@launchstack/adapters must not read process.env — " +
                        "configuration is injected by the composition roots.",
                },
            ],
        },
    },
    // @launchstack/features builds vertical features on top of core. It can
    // read process.env, but must not depend on Next / Clerk / React (those
    // live in apps/web — features should work in any Node host).
    {
        files: ["packages/features/src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["next/*", "next", "@clerk/*", "react", "react-dom"],
                            message:
                                "@launchstack/features must not import Next, Clerk, " +
                                "or React. Those belong in apps/web. Feature code " +
                                "has to work in any Node host.",
                        },
                        {
                            group: ["~/*"],
                            message:
                                "@launchstack/features cannot import from apps/web " +
                                "(~/*). Rewrite as a relative import inside the " +
                                "feature or as an @launchstack/core subpath.",
                        },
                    ],
                },
            ],
        },
    },
    // Every chat request goes through one OpenAI-compatible transport, which
    // is the only module allowed to construct a chat client. A feature that
    // builds its own skips route resolution, declared-behavior filtering, and
    // usage normalization — and can silently borrow an unrelated API key.
    {
        files: ["packages/**/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
        ignores: ["packages/adapters/src/llm/openai-compatible-transport.ts"],
        rules: {
            "no-restricted-imports": ["error", { paths: chatClientImportBans }],
        },
    },
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
