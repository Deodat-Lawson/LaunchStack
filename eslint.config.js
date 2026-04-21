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
    allConfig: js.configs.all
});

const eslintConfig = [
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            "dist/**",
            "drizzle/**",
            "next-env.d.ts",
            "eslint.config.js",
            "__tests__/**",
            "jest.config.mjs",
            "public/vad/**",
            "scripts/**",
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

            "@typescript-eslint/consistent-type-imports": ["warn", {
                prefer: "type-imports",
                fixStyle: "inline-type-imports",
            }],

            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
            }],

            "@typescript-eslint/require-await": "off",

            "@typescript-eslint/no-misused-promises": ["error", {
                checksVoidReturn: {
                    attributes: false,
                },
            }],

            "drizzle/enforce-delete-with-where": ["error", {
                drizzleObjectName: ["db", "ctx.db"],
            }],

            "drizzle/enforce-update-with-where": ["error", {
                drizzleObjectName: ["db", "ctx.db"],
            }],
        },
    },
    // @launchstack/core is the publishable engine — it must stay free of
    // Next, Clerk, React, apps/web env.ts, and raw process.env reads. Any
    // runtime config must come through CoreConfig. These guards enforce the
    // boundary so regressions show up at lint time, not when someone tries
    // to consume the package from a non-Next host.
    {
        files: ["packages/core/src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": ["error", {
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
            }],
            "no-restricted-globals": ["error", {
                name: "process",
                message:
                    "@launchstack/core must not read process.env. " +
                    "Accept runtime config through CoreConfig / configure* hooks.",
            }],
        },
    },
    // @launchstack/features builds vertical features on top of core. It can
    // read process.env, but must not depend on Next / Clerk / React (those
    // live in apps/web — features should work in any Node host).
    {
        files: ["packages/features/src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": ["error", {
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
            }],
        },
    },
];

export default eslintConfig; 