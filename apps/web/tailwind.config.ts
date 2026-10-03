import { type Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

// Every color resolves through the design tokens
// (@launchstack/design-tokens/tokens.css). The relative-color wrapper
// exists so Tailwind's `/opacity` modifiers compose with var()-backed
// colors: bg-panel-2/30 → oklch(from var(--panel-2) l c h / 0.3).
const token = (name: string) => `oklch(from var(--${name}) l c h / <alpha-value>)`;

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
                lg: "var(--r-md)",
                md: "calc(var(--r-md) - 2px)",
                sm: "calc(var(--r-md) - 4px)",
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
                surface: {
                    DEFAULT: token("bg"),
                    2: token("bg-2"),
                    sunk: token("bg-sunk"),
                },
                panel: {
                    DEFAULT: token("panel"),
                    2: token("panel-2"),
                },
                ink: {
                    DEFAULT: token("ink"),
                    2: token("ink-2"),
                    3: token("ink-3"),
                    4: token("ink-4"),
                },
                line: {
                    DEFAULT: token("line"),
                    2: token("line-2"),
                },
                brand: {
                    DEFAULT: token("accent"),
                    hi: token("accent-2"),
                    deep: token("accent-deep"),
                    // Pre-mixed translucent tokens: no alpha modifier.
                    glow: "var(--accent-glow)",
                    soft: token("accent-soft"),
                    ink: token("accent-ink"),
                    fg: token("accent-fg"),
                },
                success: {
                    DEFAULT: token("success"),
                    soft: token("success-soft"),
                },
                danger: {
                    DEFAULT: token("danger"),
                    fg: token("danger-fg"),
                    soft: token("danger-soft"),
                },
                warn: {
                    DEFAULT: token("warn"),
                    soft: token("warn-soft"),
                },
                info: {
                    DEFAULT: token("info"),
                    soft: token("info-soft"),
                },
            },
            keyframes: {
                // Loading states hold back for a beat, then fade in, so a load
                // that finishes quickly never flashes one (see _components/loading).
                "loader-in": {
                    from: { opacity: "0" },
                    to: { opacity: "1" },
                },
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
                "loader-in": "loader-in 200ms ease-out 150ms both",
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    plugins: [
        // Widths of the pane an app sits in, not of the window. Every
        // workspace pane is a size container (StudioSplitView's pane hosts),
        // so `@max-sm:hidden` reads "hide when this pane is under 520px" —
        // a chat in a third of the screen gets the compact toolbar even on a
        // wide monitor. Max-width only, on purpose: outside any container
        // nothing matches, so an app on a page of its own keeps its full
        // layout rather than its narrowest.
        //
        // Registered widest first, because Tailwind emits variants in the
        // order they are added and the later rule wins: `@max-md:text-[34px]
        // @max-sm:text-[28px]` must give 28px under 520px, which ascending
        // order got backwards. `@max-lg` and `@max-xl` are for the Studio
        // tools, whose screens are laid out for a full-width tab and fold
        // as the tab narrows (see components/tool-app).
        plugin(api => {
            api.addVariant("@max-xl", "@container (max-width: 1119px)");
            api.addVariant("@max-lg", "@container (max-width: 879px)");
            api.addVariant("@max-md", "@container (max-width: 639px)");
            api.addVariant("@max-sm", "@container (max-width: 519px)");
            api.addVariant("@max-xs", "@container (max-width: 379px)");
        }),
    ],
} satisfies Config;
