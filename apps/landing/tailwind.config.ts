import { type Config } from "tailwindcss";

// Nearly bare: the landing surface is built on CSS modules that read the
// shared design tokens directly. Only the font families are mapped, so
// font-sans / font-mono mean the same thing here as in apps/web.
export default {
    content: ["./src/**/*.{ts,tsx}"],
    darkMode: ["selector", '[data-theme="dark"]'],
    theme: {
        extend: {
            // Same mapping as apps/web: font-sans/-mono resolve to the shared
            // tokens, not Tailwind's stock stacks.
            fontFamily: {
                sans: ["var(--font-sans)"],
                serif: ["var(--font-serif)"],
                mono: ["var(--font-mono)"],
            },
        },
    },
    plugins: [],
} satisfies Config;
