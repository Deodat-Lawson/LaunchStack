# @launchstack/design-tokens

The single source of truth for colour, type, spacing, radius, shadow and
z-index, shared by apps/web and apps/landing, plus the theme-choice cookie
both apps read. No build step, no React. It deliberately does not contain
component styles — components consume semantic tokens; only this file may
reference primitives.

## Use

```css
@import "@launchstack/design-tokens/tokens.css";
```

## API

| Export         | What it is                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `./tokens.css` | primitives (hue, scales, fonts) feeding semantic tokens (surfaces, ink, lines, accent, status)         |
| `./theme`      | the `ls-theme` cookie: the latest theme chosen on either site, and the `<head>` script that applies it |

Type: `--font-sans` (Inter) and `--font-mono` (JetBrains Mono) resolve to
the next/font variables each app's `src/app/fonts.ts` sets from the files in
[`fonts/`](#fonts); `--font-serif` is the system serif and loads nothing.
`--fw-display` is the heading weight.

Two selectors only: `:root` (light) and `[data-theme="dark"]`. The ink
ladder is a measured contrast contract — each tier carries its ratio in a
comment. The code surface and the mindmap's paper palette deliberately
ignore the app theme.

## Theme choice

The landing site and the app are separate origins, so next-themes'
localStorage never crosses between them. `theme.ts` keeps the latest choice
in a cookie on the domain they share (the registrable domain, found by
probing: the browser refuses a public suffix; host-only on localhost, where
ports share cookies anyway). Its value is `<theme>.<ms>`.

- Each app's root layout inlines `THEME_BOOT_SCRIPT` in `<head>`. It copies
  the cookie into next-themes' localStorage before next-themes' own script
  runs, so the first paint is already in the latest choice.
- Each app's `ThemeChoiceSync` writes the cookie whenever the theme changes.
- Inside a workspace, apps/web's `PreferenceSync` compares the cookie's time
  with the account setting's `updatedAt`; the later one wins, and a newer
  browser choice is saved to the account.

Both apps list this package in `transpilePackages` (the module is
TypeScript source).

## Fonts

The two web fonts are self-hosted here. Both apps load them with
`next/font/local` from a relative path (`../../../../packages/design-tokens/fonts/…`
in `src/app/fonts.ts`), so neither `next dev` nor `next build` nor a Docker
build contacts Google Fonts.

| File                  | Face                        | Axes                     | Size   |
| --------------------- | --------------------------- | ------------------------ | ------ |
| `Inter.woff2`         | Inter 4.001 (git-66647c0bb) | opsz 14–32, wght 100–900 | 241 KB |
| `JetBrainsMono.woff2` | JetBrains Mono 2.211        | wght 400–500             | 41 KB  |

They are built from the TTFs Google Fonts serves (the `google/fonts`
repository, pinned by commit in `build-fonts.py`) and cut the way Google cuts
them: the same unicode ranges (the union of its latin, latin-ext, vietnamese,
greek and cyrillic subsets, in one file per face instead of seven) and the same
OpenType features. Every codepoint `next/font/google` served is here with the
same metrics, plus a few spaces and punctuation marks inside those ranges that
Google's subsetter drops.

Why not `next/font/google`: Google Fonts sometimes answers with extensionless
`fonts.gstatic.com/l/font?kit=…&skey=…` URLs. Next 15.5 rejects them, in
Turbopack's Rust loader (500 on every route of `next dev --turbo`) and in the
webpack loader (failed `next build`). Upstream fix: vercel/next.js#100158,
canary only. A build that never calls Google cannot be broken by it.

To rebuild (for example, a new Inter release):

```sh
python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools brotli
/tmp/fonts/bin/python packages/design-tokens/fonts/build-fonts.py
```

The output is deterministic for a given fonttools version (the committed files
were built with 4.67.0).

## License

Apache-2.0 — see [LICENSE](LICENSE). The fonts are under the SIL Open Font
License 1.1: [OFL-Inter.txt](fonts/OFL-Inter.txt),
[OFL-JetBrainsMono.txt](fonts/OFL-JetBrainsMono.txt).
