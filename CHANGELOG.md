# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Proposals** - a writing app of its own in Tools, with a Studio tile: find
  the funders that fit, then write the proposal from what your sources prove
  - Profile: what the workspace's sources can prove, fact by fact with
    citations; edit a fact by hand, rebuild after new reports land
  - Funders: a search planned from the profile over Grants.gov (public API,
    no key) and the web (with an EXA/SERPER key), each call scored for fit
    with why and concerns; save, dismiss, or apply from the row; a link to
    Investor relations for equity
  - Write: paste a call, give its link, or pick a Source; it becomes a
    checklist (eligibility, every question with its word limit, attachments,
    format, deadline) and an outline of sections to write
  - An editor per section: draft from the sources with numbered evidence and
    the gaps named, rewrite (tighten to the limit, more specific, plainer,
    stronger, or your own instruction), approve, save to the Library; the
    evidence rail shows what the answer cites; "Ask in chat" hands a question
    about the sources to the Studio chat (`?ask=` on the workspace)
  - A review that reads the drafts like a programme officer, readiness on
    every row, a whole-document preview, export into Sources as markdown
  - Runs execute in the web process after the response, or on the worker
    with `PROPOSALS_EXECUTOR=worker`; every run lists in History
  - `@launchstack/tools/grant-search` (Grants.gov + web listings) and
    `@launchstack/pipelines/proposals` (six tables, six stages, the run
    orchestrator); preview at `/dev/proposals`

- **Split the workspace centre** - panes side by side and stacked, nested as
  deep as you split them (up to six), each its own strip of tabs
  - Drag a tab, or a source from the sidebar, onto a pane: its edges split
    that way, its middle opens it there; the workspace's own edges make a pane
    the full height or width
  - ⌘/Ctrl-click a source or a Studio app to open it beside what is showing;
    double-click a tab to maximize its pane
  - One "⋯" menu per pane: split right, split down, maximize, close
  - Dividers drag and take arrow keys; a split that would leave a pane too
    small to use is refused
  - A pane moved or split keeps its draft, scroll and undo — it is the same
    pane, not a rebuilt one
  - The arrangement is remembered per member and workspace, and survives a
    window too narrow for panes
  - New bindings in Settings → Shortcuts: split right (⌘⌥\), split down
    (⌘⌥⇧\), maximize (⌘⇧↩), focus the next or previous pane (⌘⌥] and ⌘⌥[),
    close the current app (⌘⌥W)
  - Apps fit the pane they are in, not the window: the composer drops to icons
    and Meetings stacks its channel list in a narrow pane  - The document viewer folds its versions and notes rail into a Details
    panel once its column is too narrow for both
- **Resizable sidebar** - drag its edge (or use the arrow keys) between 220 and
  520px; the width is remembered
- **Studio apps open in centre tabs** - the workspace centre is a tab strip
  rather than one pane at a time
  - Open, close, middle-click close, drag to reorder, Alt+Arrow to reorder,
    Delete or Backspace to close, overflow scroll, and an empty-workspace state
  - Every open pane stays mounted, so switching apps keeps drafts, scroll
    position and undo history
  - The Studio drawer is a picker: it no longer hosts panes, and the Expand
    button is gone because there is nothing left to expand into
  - A mindmap in a background tab, or behind a source preview, no longer
    consumes keyboard and paste events
  - `?feature=workflows`, `?feature=analytics` and `?feature=metadata` open
    their panes again instead of showing "Unknown feature"

- **OCR Processing Feature** - Advanced optical character recognition for scanned documents
  - New OCR service module (`src/app/api/services/ocrService.ts`) with Datalab Marker API integration
  - Asynchronous submission and polling architecture for OCR processing
  - Configurable OCR options (force_ocr, use_llm, output_format, strip_existing_ocr)
  - Comprehensive error handling and retry logic with 5-minute timeout
  - Database schema enhancements: `ocrEnabled`, `ocrProcessed`, `ocrMetadata` fields
  - Frontend OCR checkbox in document upload interface with help text
  - Custom styling for OCR checkbox with dark theme support
  - Optional `DATALAB_API_KEY` environment variable for OCR functionality
- Enhanced environment variable validation in `src/env.js` with comprehensive schema for all required variables
- New constants file (`src/lib/constants.ts`) for centralized configuration management
- API utilities (`src/lib/api-utils.ts`) for standardized error handling and response patterns
- Comprehensive TypeScript types (`src/types/api.ts`) for better type safety across the application
- Missing environment variables in `.env.example` file with proper documentation

### Changed

- **Claude artifacts and coding sessions are sources you add**, not Studio
  tools
  - Add a source → Claude artifact: paste or upload an artifact's code and it
    becomes a source — listed, searchable, citable — opened in a sandboxed
    preview. Artifacts imported before can be added as sources in one click;
    the old copies go to Settings → Archive
  - Add a source → Coding sessions holds the whole sessions browser: import,
    rescan, open, continue in chat
  - `/employer/artifacts`, `/employer/agent-sessions`, their palette entries
    and old `?feature=` links now open those tabs
- **New meeting shows the whole plan at once** - workflows down the left
  (grouped as on the Meetings home), the brief, room and phases in the
  middle, and how it runs — who speaks next, chair, turn limit, agenda, Slack
  — on the right, with nothing behind a "Show details" link
  - Seats are cards that name the chair and the workflow's suggested agents
  - Under a 1024px dialog the workflow list becomes a picker; on a phone the
    columns stack
  - Start says what is missing ("Add a title to start.") instead of just
    greying out, and a failed start shows its error above the buttons

### Enhanced

- **Document Upload API** (`src/app/api/uploadDocument/route.ts`):
  - Dual-path processing architecture: OCR path for scanned documents, standard path for digital PDFs
  - Unified chunking and embedding pipeline for both processing methods
  - Stores OCR metadata with document records for tracking and analytics
  - Support for `enableOCR` parameter in upload requests
  - Improved type safety with proper TypeScript interfaces

- **Predictive Document Analysis API** (`src/app/api/agents/predictive-document-analysis/route.ts`):
  - Improved input validation with detailed error messages
  - Enhanced error handling with specific error types and HTTP status codes
  - Better timeout and configuration management using centralized constants
  - More descriptive error responses with timestamps and error categorization
  - Improved type safety with proper TypeScript interfaces

- **Loading Component** (`src/app/_components/loading.tsx`):
  - Added proper TypeScript interface with optional props
  - Enhanced accessibility with ARIA labels and roles
  - Improved component reusability with configurable message and title props
  - Better semantic HTML structure

### Improved

- Code organization with centralized constants and utilities
- Type safety across API endpoints and components
- Error handling consistency throughout the application
- Development experience with better IntelliSense and type checking
- Documentation and code maintainability

### Fixed

- **Dev server memory leak** — `next dev` no longer grows by about 1 GB of live heap per hour. Three causes, all measured with heap snapshots under a polling workload:
  - The React Flight development runtime that Next loads into its router process tracked every async operation in the process and linked them into one chain that was never released (99% of the growth). `patches/next@15.5.7.patch` now starts that tracking only inside a React render (`app-page-turbo.runtime.dev.js`).
  - Next's "show once" Turbopack warnings were deduplicated by object identity, so every request added an entry and printed the warning again. The patch keys them by issue content, and `apps/web` now resolves the same `@langchain/community` as `packages/retrieval` and declares `@langchain/ollama`, which removes the warnings themselves.
  - The auth and middleware Postgres clients were created per module evaluation, so each dev recompile left an open pool pinning the previous module graph (about 30 MB per edit). They are now shared per process, like the engine's pool.
  - Before: about 160 MB/min of retained heap while polling. After: live heap stays between 363 and 408 MB with polling, RAG/document/starter traffic and an HMR edit every 45 s. Regression tests cover tracker retention and the one-pool-per-process client.
- **Bounded web-research cache** — `createTtlCache` now enforces `maxEntries`: it evicts expired entries and then the oldest writes. Before, only expired entries were pruned, so fresh entries (ask starters, grant search, trend search, competitor analysis) grew without bound.
- The New meeting dialog was 512px wide whatever it asked for (the kit's
  `sm:max-w-lg` outranked its `max-w-none`), and the New meeting button
  opened on a blank room because its default workflow had been renamed
- Unchecked switches were invisible in light mode: the kit Switch's track
  and dark-mode thumb named colours that no longer exist
- Picking the workflow that is already applied no longer throws away the
  edits made to it, and unseating a moderated meeting's chair hands the chair
  to someone still in the room
- Outline buttons had no outline: the global button reset set
  `border-style: none`, which Tailwind's `border` utility does not undo
- ⌘⌥ shortcuts never fired on a Mac, where Option changes the character a key
  types (⌥\ is «); combinations with Option now match the key pressed
- **Document lifecycle correctness:** Uploads, new versions, ZIP children, and archive summaries now atomically persist their document/version/job state, converge retries through stable idempotency keys, dispatch only after job creation, and propagate strict version IDs. Users no longer get stranded or duplicate document trees when a request or dispatch is retried; dispatch remains non-outbox and ambiguous remote acceptance relies on stable event-ID dedupe/retry.
- **TypeScript/ESLint Compliance**:
  - Replaced all `any` types with proper TypeScript types in `ocrService.ts`
  - Fixed unsafe type assignments and member access violations
  - Removed trivially inferred type annotations
  - Replaced logical OR (`||`) with nullish coalescing (`??`) for safer null/undefined handling
  - Improved type safety in `uploadDocument/route.ts`
  - All linter errors resolved (38 errors fixed)

### Technical Improvements

- Centralized configuration management
- Standardized API response patterns
- Enhanced error categorization and handling
- Better separation of concerns
- Improved code reusability and maintainability

### Environment & Configuration

- Added comprehensive environment variable validation
- Updated `.env.example` with all required variables and documentation
- Better configuration management with centralized constants
- Improved development setup documentation
- Added `DATALAB_API_KEY` for optional OCR functionality

### Documentation

- **README.md** - Comprehensive OCR feature documentation:
  - Added OCR processing section with detailed usage guide
  - When to use OCR (scanned documents, image-based PDFs, handwritten content)
  - Backend infrastructure details (service module, database schema, API integration)
  - Frontend integration documentation (UI, validation, styling)
  - Processing flow diagrams for both standard and OCR paths
  - OCR vs Standard processing comparison table
  - Error handling documentation
  - Datalab API setup instructions
  - Environment variables reference updated with `DATALAB_API_KEY`
  - API endpoints section updated with OCR support details
  - Project structure updated to include OCR service
  - Added OCR troubleshooting section
- **CHANGELOG.md** - Documented all OCR feature additions and linter fixes

## [Previous Versions]

This changelog starts from the current state of the codebase. Previous version history can be found in the git commit history.
