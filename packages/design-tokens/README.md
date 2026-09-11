# @launchstack/design-tokens

The single source of truth for colour, type, spacing, radius, shadow and
z-index, shared by apps/web and apps/landing. Pure CSS, no build step, no
React. It deliberately does not contain component styles — components
consume semantic tokens; only this file may reference primitives.

## Use

```css
@import "@launchstack/design-tokens/tokens.css";
```

## API

| Export | What it is |
| --- | --- |
| `./tokens.css` | primitives (hue, scales, fonts) feeding semantic tokens (surfaces, ink, lines, accent, status) |

Two selectors only: `:root` (light) and `[data-theme="dark"]`. The ink
ladder is a measured contrast contract — each tier carries its ratio in a
comment. The code surface and the mindmap's paper palette deliberately
ignore the app theme.

## License

Apache-2.0 — see [LICENSE](LICENSE).
