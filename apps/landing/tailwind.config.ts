import { type Config } from "tailwindcss";

// Deliberately bare. The landing surface is built on two self-contained CSS
// modules (marketing.module.css, deployment.module.css) that declare their own
// token sets; Tailwind is here only for the stock utilities a handful of
// deployment sections use (spacing, text-purple-*, w-5/h-5, dark:). None of the
// shadcn token classes (bg-background, text-muted-foreground, …) appear in this
// app, so apps/web's theme extension and globals.css are not needed.
export default {
    content: ["./src/**/*.{ts,tsx}"],
    darkMode: ["class"],
    theme: { extend: {} },
    plugins: [],
} satisfies Config;
