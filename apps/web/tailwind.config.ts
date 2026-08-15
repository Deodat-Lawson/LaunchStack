import { type Config } from "tailwindcss";

export default {
    content: ["./src/**/*.{ts,tsx}"],
    // next-themes stamps data-theme on <html>; this keys every `dark:`
    // variant off it (the `.dark` class it also stamps is inert here).
    darkMode: ["selector", '[data-theme="dark"]'],
    theme: {
        extend: {
            fontFamily: {
                sans: ["var(--font-sans)"],
                serif: ["var(--font-serif)"],
                mono: ["var(--font-mono)"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            boxShadow: {
                1: "var(--shadow-1)",
                2: "var(--shadow-2)",
                3: "var(--shadow-3)",
            },
            zIndex: {
                sticky: "var(--z-sticky)",
                nav: "var(--z-nav)",
                dropdown: "var(--z-dropdown)",
                overlay: "var(--z-overlay)",
                modal: "var(--z-modal)",
                toast: "var(--z-toast)",
                tooltip: "var(--z-tooltip)",
            },
            colors: {
                // ── Canonical namespace: plain var() onto the Launchstack
                // OKLCH tokens (@launchstack/design-tokens). No hsl()
                // wrapper, so no `/opacity` modifiers — translucency comes
                // from pre-mixed tokens (brand-glow, brand-soft).
                surface: {
                    DEFAULT: "var(--bg)",
                    2: "var(--bg-2)",
                    sunk: "var(--bg-sunk)",
                },
                panel: {
                    DEFAULT: "var(--panel)",
                    2: "var(--panel-2)",
                },
                ink: {
                    DEFAULT: "var(--ink)",
                    2: "var(--ink-2)",
                    3: "var(--ink-3)",
                    4: "var(--ink-4)",
                },
                line: {
                    DEFAULT: "var(--line)",
                    2: "var(--line-2)",
                },
                brand: {
                    DEFAULT: "var(--accent)",
                    hi: "var(--accent-2)",
                    deep: "var(--accent-deep)",
                    glow: "var(--accent-glow)",
                    soft: "var(--accent-soft)",
                    ink: "var(--accent-ink)",
                    fg: "var(--accent-fg)",
                },
                success: "var(--success)",
                danger: "var(--danger)",
                warn: "var(--warn)",
                info: "var(--info)",

                // ── Deprecated shadcn compat namespace (values in
                // src/styles/compat.css). Keeps the hsl() wrappers because
                // the shadcn primitives rely on `/opacity` modifiers.
                // Dies with compat.css when the primitives are re-themed.
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                // Plain var() on purpose: the old hsl(var(--accent)) wrapped
                // the OKLCH accent token and produced invalid CSS — shadcn
                // hover/selected states rendered transparent.
                accent: {
                    DEFAULT: "var(--accent-soft)",
                    foreground: "var(--accent-ink)",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
            },
            keyframes: {
                "accordion-down": {
                    from: {
                        height: "0",
                    },
                    to: {
                        height: "var(--radix-accordion-content-height)",
                    },
                },
                "accordion-up": {
                    from: {
                        height: "var(--radix-accordion-content-height)",
                    },
                    to: {
                        height: "0",
                    },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    plugins: [],
} satisfies Config;
