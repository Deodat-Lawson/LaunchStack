# Growth — design rules for this surface

Growth is one app with two areas, Brand and Prospects, in one rail. Shared
pieces (`PageHeader`, `EmptyState`, `SkeletonRows`, `useResource`, the
formatters) live at the app level; each area keeps its own screens, API
client and components. Brand's calendar and composer follow every rule
below; a network is a monogram in the ink ladder, never a brand colour.

Prospects is an **operate** surface: someone opens it every morning to decide
who to talk to. The design should vanish into that task. These rules are the
app's tokens (`packages/design-tokens/tokens.css`) plus the parts of the
impeccable / taste-skill / UI Craft guidance that apply to a dense product
screen. They are checked in the finish pass; see the last section.

## Type roles

- **UI**: Inter Tight (`font-sans`), weights 400 / 500 / 600 only. Controls and
  table cells 13px, body 14px, secondary 12px, chips 11.5px. Fixed pixel scale;
  no `clamp()` in product UI.
- **Voice**: Instrument Serif (`font-serif`) for **one line per screen** — the
  `PageHeader` title — with one italic phrase in `text-brand-ink`. Never in
  labels, buttons, table cells or data.
- **Data**: JetBrains Mono (`font-mono`) for domains, ids and aligned numbers,
  always with `tabular-nums`. Counts in prose stay in the sans.
- Labels are sentence case at 12–13px in `text-ink-3`. No tracked-uppercase
  kickers, no icon tile beside a heading.

## Color roles

- Canvas `bg-surface`, rail `bg-surface-2`, panels `bg-panel`, hover and
  skeletons `bg-panel-2`. Hairlines inside a list `border-line-2`, around it
  `border-line`.
- **Accent is for three things**: the primary button, the current selection,
  and fit above the segment threshold (`FitMeter`). Nowhere else — not stages,
  not kinds, not icons.
- **Semantic color is status, always with a word**: `warn` for stale and guessed
  emails, `success` for won and verified, `danger` for lost, failed and errors.
  A stage is a dot and a word (`StagePill`); a source is an outline chip
  (`SourceChip`, dashed = signal).
- Ink ladder as documented in tokens.css: `ink-3` is the smallest tier for real
  text; `ink-4` only for chrome such as keyboard hints.

## Shape and space

- Three radii by role: controls and chips `rounded-md` / `rounded-full`, panels
  and rows `rounded-lg`, sheets and dialogs their kit default. A uniform radius
  everywhere is a generated-UI tell.
- 4 / 8px grid. List rows 44px, dense table rows 40–52px. Section gaps at least
  twice the gap inside a section (`gap-7` between sections, `gap-2` inside).
- Panels sit flat. Shadows only on things that float: the bulk bar, menus,
  popovers, the run sheet.
- No card inside a card. A list is a bordered panel with hairline rows.

## Hierarchy

- Each screen: one serif headline, one primary action (top right, `Find
companies` or the screen's verb), at most four regions.
- Tables may run wide; prose stays under 70ch (`max-w-[70ch]`).
- Empty states name the next action and carry its control (`EmptyState`).
- Loading is skeleton rows at the real row height (`SkeletonRows`), never the
  word "Loading". Filters and the primary button stay interactive meanwhile.

## Motion

- 150–250ms, ease-out, transform and opacity only. Nothing animates on page
  load.
- Motion conveys state: a row entering, a stage dot changing, the run sheet
  opening, the step list ticking. `prefers-reduced-motion` removes all of it;
  spinners become static rings (`motion-reduce:animate-none`).

## Words

- Nouns: **Segment, Company, Person, Deal, Source, Run**. Never program,
  partner, importer, dossier, candidate.
- Buttons say what happens: Find companies, Add to outreach, Exclude, Move to
  Qualified, Confirm segment, Take it. Never Submit, Refresh, OK.
- Errors say what failed and how to recover, inline, next to the control.
- Rules are enforced by controls, not explained in sentences: the stage menu
  disables illegal moves and shows the reason under each.

## Finish pass (run before shipping a screen)

1. Only token classes; no hex, no raw Tailwind palette (`eslint .` from the
   repo root warns).
2. Three radii, three weights, one serif line, one primary action.
3. `focus-visible` ring on every interactive element; tab order matches visual
   order; every icon-only button has `aria-label`.
4. `tabular-nums` in every numeric column.
5. Both themes checked in `/dev/prospects` (theme follows `data-theme` on
   `<html>`); dark is composed from the ladder, not inverted.
6. Reduced motion honored; no placeholder copy left in production paths.
7. Empty, loading and error states exist for every region that loads data.
