# Vantage visual redesign — 2026-11-16

Branch: `codex/vantage-realistic-sample-docs-20261116`. Parent: `dc63cfbb70cb4e4c87f342120ca68a154c3287b6`. Exact published commit is supplied in the delivery message.

## Changed

- Both screens use a sunk surface, panel cards, a 760px column, prose bounded to 68ch, and existing token sizes 13/15/18/22px with weights 400/600. Inter and the font loaders are unchanged.
- This week has Monday week arrows, report-version menu, a toolbar injected badge, primary Generate for empty weeks and outline Regenerate for existing reports. The brief, collapsed summary and compact stat tiles share one card. Topics form a single-open accordion with a segmented decision count and automatic advance after a successful save.
- An undecided recommendation prefills the decision field. Editing produces a distinct draft, clearing stays empty, and Reset explicitly restores the suggestion. Change decision starts from the recorded text. Only an explicit save posts; the client sends the displayed text verbatim. The existing server whitespace normalization is unchanged. Draft identity, report isolation, stale replies, active pointer and duplicate-submit guards remain intact.
- Citations have stable report-wide numbers, full accessible names and hover/keyboard tooltips. The existing evidence dialog and source list use the same inventory. Recommendation reasons and uncertainty remain inside Why and evidence.
- Context uses a three-step clickable stepper and single-open sections with saved summaries. Closing a section preserves unsaved form state. Responsibilities/priorities sit side by side on wide screens, with their limits hint beneath. Advanced scope logic is unchanged.
- Accordion, decision status and active-stage motion respect reduced motion. Only the preview's NDJSON simulator adds 1.2 seconds per stage; product progress still follows existing server events without timed phase advancement. English/Chinese ICU caution counts omit zeros and handle plurals.

## Removed

Replaced the separate recommendation callout, initially blank recommendation editor, native date input, always-expanded topic/Context layout and long citation chips. Updated their tests and deleted obsolete catalogue keys (`week`, `recommendation`, `summary`, `openThisWeek` in their former Weekly Review namespaces). No old copies or compatibility aliases were added.

## Verified now

- Focused Jest: **327 passed across 29 suites**, including decision-state cases, existing request/draft guards, Context, citations, simulator, i18n, navigation and typography. The 40 i18n checks are included; `npx --no-install jest src/i18n --runInBand` was also executed independently.
- Current-source web TypeScript: **0 diagnostics**. Changed-file lint: **0 errors/warnings**. Formatting and diff whitespace checks passed. The typography guard's existing path comparisons were normalized for Windows; none of its font restrictions or exemptions changed.
- Auth-free `/dev/vantage` and `/dev/vantage/context`: confirmed one unchanged suggestion, edited/saved another, observed accordion advance twice, preserved a folded draft, changed from recorded text, and verified no automatic decision write. Numbered citation opened the dialog; hover and real keyboard focus showed its title/version.
- All four preview stages were visibly active in order, approximately 1.2 seconds apart. Context stepper opened and scrolled to the requested section, retained a role draft while folding, and displayed the Go to This week action after setup.
- Both routes checked at 1280px and 390px in light/dark themes. No page/toolbar overflow; the desktop column measured 760px. Browser text measurements contained only the four sizes and two weights. Reduced-motion checks found no accordion or stage animation.

## Boundaries

No backend, pipeline, budget, prompt, validator, schema, retrieval policy or database changes; **0 paid calls**. The existing paid-attempt ledger remained at five historical attempts with its original timestamp. Browser checks used fictional in-memory preview data, not real model quality or production integration. Three existing E2E specs were updated and statically checked, not run wholesale. Current-source TypeScript/lint use the existing private source mapping because the installed dependency junction points to an older checkout; dependencies were not relinked or installed. Existing untracked reports and private artifacts remain uncommitted. No PR, merge or deployment.
