# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Long-meeting note generation** — Large transcripts and owner-note bodies now use on-demand, size-bounded summaries before final composition, with two concurrent requests per enrichment and additional reduction only when needed. Short meetings retain the single-call path. Transcript/owner-note sources remain separate, oversized Unicode segments retain their text and attribution, and a failed summary cannot produce a partial-evidence proposal. Final streaming previews and explicit note acceptance are unchanged.
- **Automatic note proposals after Stop** — Native JSON-schema streaming in the shared structured-output helper now sends the strict-converted schema with `strict: true`, matching the compaction summaries. Before, the final streamed proposal could come back without its required fields, so automatic enrichment after Stop failed while a manual retry of the same revision succeeded. Covered by a wire-level request test and the HTTP/PostgreSQL Stop-to-proposal E2E test.
- **Main-branch reconciliation** — Call Notes now uses the current `@launchstack/pipelines`, store, LLM, retrieval, and better-auth workspace contracts. Preserved applied migration SQL while reconciling journal/snapshot history, including workspace sessions and Google Drive document origins; the resulting schema matches the final application schema and excludes retired Zoom and bookmark tables. Chat history persists the same filtered source context used for retrieval, keeping Call Notes out of the workspace's selected-source context.
- **PR reconciliation and scope audit** — Merged current Gmail, settings, and Prospects changes without losing Call Notes; reconciled migration snapshots without rewriting applied SQL; preserved command-palette Settings deep links when leaving Calls. Removed incidental generated pipeline output changes, unused capture-worker settings/database credentials, its unused direct database dependency, and an unused fixture collection. CI now runs capture-worker tests on Node 24 while the web capture integration test remains compatible with the web application's Node 20 runtime.
- **Studio tabs reconciliation** — Merged main's tabbed Studio, split columns, context-menu layer, and lucide icon set without losing Call Notes. Calls is a Studio tab whose `?feature=calls&call=` URL follows tab focus, tab close, and browser history; Call Notes open in Calls from the rail, the palette, `?source=` links, and "Open to the side", and never enter chat context. `?source=` deep links are no longer dropped while the session is still resolving. Calls styles use the font tokens. Main's three migrations follow the Call Notes migrations in the journal, and their snapshots carry the Call Notes tables so the next generate emits no drops.
- **Chat-configuration guard restored** — An earlier main merge deleted main's "error handlers do not re-enter chat configuration" test instead of satisfying it. The test is back unchanged. The Call chat route now resolves its model after authentication and before loading the Call, so a misconfigured model reports its configuration error without first loading Call data.
- **Calls redirect build compatibility** — The `/calls` page now uses the required Next.js page-props signature while retaining its workspace/deep-link redirect behavior.
- **Local capture worker authentication** — Let the exact private worker ingress reach its scoped bearer-token checks without a browser session. Calls user APIs and neighboring internal paths remain session-protected.
- **Call title renaming** — Removed the purple outline during inline title editing; text selection remains visible, and keyboard focus is still indicated before editing.
- **AI proposal review notice** — Kept the subtle highlighted container with a uniform border; removed the thick left accent. Accepted notes do not show a review banner.

### Known gaps

- **Call Notes as indexed files** — The intended product treats canonical Call Notes like normal files for indexing and permission-scoped agent retrieval. This reconciliation retains the existing opt-in note-index path and chat-selection exclusions; it does not implement normal-file/RAG integration. The current implementation gaps and required verification are recorded in `docs/call-notes/implementation-contract.md`.

### Removed

- **Transcript bookmarking** — Removed marker controls and guidance, bookmark commands/capabilities, storage queries, and AI bookmark inputs/citations. A forward migration drops the bookmark table, purges retained bookmark-command payloads, and strips retired citation metadata from saved proposals without rewriting notes or transcript evidence.

### Added

- **Current file highlight** — The workspace sidebar marks the open file with a solid accent background, including Call Notes opened from the sidebar or a deep link. Current-file state remains separate from chat-context selection and clears when returning to Calls home.
- **Integrated Call Notes** — The current frontend now connects capture controls, durable transcripts, title/rich-note autosave, visibility, deletion, and owner-reviewed AI enrichment to the backend. Canonical notes appear as permission-scoped files in the workspace's Calls folder without becoming assistant context. Browser verification covered real authentication, Azure transcription, enrichment, persistence, and file reopening with isolated synthetic audio.
- **Explicit local capture controls** — Calls now starts capture only after authenticated Start and drains outstanding transcription on Stop. A private worker polls and claims one configured user's session; silence no longer creates or finishes Calls. Added HTTP/PostgreSQL lifecycle E2E coverage and recorded deferred macOS installation, supervision, permission, and enrollment work.
- **Reliable local Capture readiness and Stop** — Start now requires a fresh scoped worker heartbeat, Live waits for required audio input, and expired claims recover with preserved evidence rather than remaining stuck. Stop closes native inputs before draining transcription; enrichment runs separately. Added 200ms speech-onset buffering and shorter 3-second utterances, worker-unavailable UI feedback, and real macOS/Azure browser verification. Shared application/worker startup and shutdown orchestration remains deferred in the specification.
- **Focused Calls workspace** — Separate date-grouped notes home and centered note view inside LaunchStack's existing main workspace pane, preserving the application sidebar and navigation. Transcript and AI chat share one bottom dock that morphs upward into the same panel, reverses smoothly on collapse, and preserves drafts, conversation history, and transcript search across mode switches. Includes searchable and copyable channel-aligned bubbles, history-safe navigation, and theme-aware purple accents.
- **Call-scoped AI chat** — Bottom composer and follow-up email drafts use the configured model with the authenticated viewer's visible note and transcript. No document retrieval or cross-call search; oversized context is rejected rather than silently truncated.
- **Tiptap Call Notes** — Owner-only rich-text note editing with double-click inline title renaming, a sticky formatting toolbar, JSON/Markdown autosave through the existing revisioned note command, stable polling, explicit conflict recovery, and idempotent retries. Read-only and private-note boundaries remain intact.
- **Chronological AI enhancement** — Call summaries now use short, discussion-driven topic headings and concise Markdown bullets instead of paragraphs or fixed appendices. The prompt prioritizes key points and removes filler and repetition while preserving user-note ideas, paraphrased inline with Markdown bold as an intuitive citation cue. The editor preserves bold through review, editing, acceptance, and reload; structured evidence metadata and the existing acceptance flow remain intact.
- **Live AI note previews** — Enhanced note Markdown now arrives during model generation through an authenticated, reconnectable SSE observer backed by bounded durable preview storage. Manual and automatic enrichment retain final schema/provenance validation and explicit acceptance; provisional text never changes the saved note.
- **Split the workspace centre** - columns side by side, each its own strip of
  tabs
  - Chat beside a document, or chat beside a tool beside a document, up to
    three columns with a draggable divider
  - "Open to the side" on any source; "Split to the right" on a tab or from
    the strip; drag a tab from one column into another
  - A pane moved between columns keeps its draft, scroll and undo — it is the
    same pane, not a rebuilt one
  - New bindings in Settings → Shortcuts: split (⌘⌥\), focus the next or
    previous column (⌘⌥] and ⌘⌥[), close the current app (⌘⌥W)
  - The palette, Studio and avatar controls move into the tab strip, where
    they are drawn once however the centre is split
  - The document viewer folds its versions and notes rail into a Details
    panel once its column is too narrow for both
- **Studio apps open in centre tabs** - the workspace centre is a tab strip
  rather than one pane at a time
  - Open, close, middle-click close, drag to reorder, Alt+Arrow to reorder,
    Delete or Backspace to close, overflow scroll, and an empty-workspace state
  - Every open pane stays mounted, so switching apps keeps drafts, scroll
    position and undo history
  - Claude Artifacts and Coding sessions now open inside the workspace instead
    of navigating away; both keep their standalone routes for direct links
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

### Enhanced

- **Streaming call-chat answers** — The call assistant renders Markdown as model text arrives instead of waiting for the full response. Model resolution explicitly enables streaming to prevent the SDK from silently returning a buffered completion. Interrupted answers are marked incomplete, retries exclude partial output, and leaving the call cancels generation.

- **Current call-chat context** — Every question uses the latest server-side transcript and saved note, with capture-state awareness and current evidence taking precedence over old answers. Completed calls also supply ready AI-enhanced notes as review drafts; accepted notes use the current canonical revision. Rejected, stale, and private proposals stay excluded.
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
