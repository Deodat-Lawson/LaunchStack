# @launchstack/pipelines

## 0.2.0

### Minor Changes

- dbef947: Add the public Accelerator Program Catalogue schema and validation contract, including sourced narratives, logos, locations, and deadline-aware Cycles. Form filling is deprecated for this feature; Form metadata, company-fit scoring, and AI execution are excluded from this schema-only change.
- 9b0620b: One company profile, read only from sources about the company.
  `@launchstack/pipelines/company-metadata` now sorts every source (about the
  company, someone else's, nothing to read), drops reference lists, tables and
  figure residue before extraction, and keeps a fact only with a quote found in
  a source about the company. The profile is reassembled from the sources that
  count plus a person's edits, so deleting or setting aside a source retracts
  what it said. New: `rebuildProfile`, `refreshForDocument`,
  `catchUpAndAssemble`, `recordOverride`, `applyFactEdit`/`resetFactEdit`,
  `profileView`; `refreshForDocument` reports the profile as building until it
  is reassembled.

  Breaking: the Proposals org profile (`proposal_profiles` and its builder) is
  removed; Proposals stages read the company profile. `@launchstack/tools`
  `company-context` moves to metadata schema 1.1.0 (`profile.summary`,
  `profile.applicant_type`, `profile.focus_areas`, `profile.facts`) and adds the
  `company_profile_sources` table.

- bb64f34: Add the distribution pipeline: a vertical that finds importers,
  distributors, wholesalers and retail accounts for a company's offering,
  researches each candidate with a bounded agent whose every fact must cite a
  page it fetched, scores fit with a deterministic rubric, and runs the
  relationship through enforced stages to a signed agreement. New tools:
  `place-search` (extracted from client-prospector, targeting perspective is
  caller data), `org-resolver` (deterministic organisation identity),
  `web-research`'s `fetchReadable` (SSRF-guarded readable-page fetch), and the
  `trade-data` and `compliance-screen` ports (null defaults; OpenSanctions
  yente adapter included). `PlannedQuery.category` widens to a string label.
  `TokenService` gains `distribution_research`.
- fd146b0: A refused stage move now says what it was as values beside its English
  message: `StageTransitionError.details` carries the stages involved, the
  moves that were allowed and the missing requirements, and each
  `StageRequirementError` names its `target` stage. The app words a refusal
  in the reader's language from these; the messages are unchanged.
- 5de9e65: The Google Drive connector exports Google Docs as Word (`.docx`) instead of
  Markdown, so a synced Doc keeps its formatting. An export action can name a
  `fallback` target (new `ExportTarget` type): Docs fall back to Markdown when
  Drive refuses the DOCX as over its ~10 MB export cap, and the collected item
  then carries the fallback's MIME and extension. Fingerprints are unchanged,
  so a Doc stored as Markdown becomes `.docx` the next time it changes in Drive.
- c2437d7: Add the extraction vertical (`@launchstack/pipelines/extraction`): read the same fields out of many documents into one table, a row per document and a cell per field, each value with the quote and page it rests on. Reads whole documents in batches, keeps a value only when its quote appears in the text, types values (text, number, date, yes/no, list), and can take a second look at image files with a vision model.
- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
- 6f0bb79: Add `connectors/microsoft-365` (OneDrive and SharePoint files) and `connectors/outlook` (mail conversations and attachments): framework-free Microsoft Graph connectors that produce knowledge items for a host sink, with read-only delegated scopes.
- c5e18d3: Add the Notion and Obsidian connectors to the connectors vertical.
  - **`@launchstack/pipelines/connectors/notion`**: a thin Notion API client
    (`/v1/search` for page discovery and the page Markdown endpoint for content,
    pinned to `Notion-Version: 2026-03-11`, with 429/5xx retry) and a
    `syncNotion` run under the `KnowledgeSink` contract. Change detection uses
    `last_edited_time`; every run is a full listing, so deleted or un-shared
    pages come back as `missingSourceIds`. A database row's properties render
    above its body.
  - **`@launchstack/pipelines/connectors/obsidian`**: `importObsidianNotes` for
    batches of vault notes. Frontmatter, wikilinks, embeds, comments and block
    ids are rendered for reading, and a note's sha256 skips unchanged notes on
    re-import. The browser-safe path rules (`isVaultNotePath`,
    `normalizeVaultPath`, `noteFolder`) are also exported on their own at
    `@launchstack/pipelines/connectors/obsidian/paths`.

- bdabd2e: Live distribution runs find companies through Exa's company index instead of
  news search (new `searchCompanies` / `describeCompanies` ports; general web
  search when Serper is the only key), and a new `lookalike` source searches for
  companies like the program's customers: the new `customerDomains` on
  `ProgramInput` / `ProgramRecord` (column `customer_domains`) and its won deals,
  up to five seeds a run. Customers join the exclusions. The research agent's
  `search_web` and competitor analysis use general web search, and the discovery
  playbook plans queries that describe the companies themselves.
- 8e2e7cc: Web search is provider-agnostic. One setting, `SEARCH_PROVIDER`, picks the
  engine for every search from a provider registry (`SEARCH_PROVIDERS`): `exa`
  (`EXA_API_KEY`), `serper` (`SERPER_API_KEY`), `brave`
  (`BRAVE_SEARCH_API_KEY`), `tavily` (`TAVILY_API_KEY`) or `searxng`
  (`SEARXNG_URL`, a self-hosted SearXNG instance with JSON output enabled).
  Unset or empty, the first provider with a credential wins, in that order, so
  Exa-first setups behave as before. A named provider without its credential
  turns web search off, logged once and reported by `describeSearchSetup()`,
  instead of switching to another engine. The trend-search strategies
  `fallback` and `parallel` are removed; configurations that still set them are
  treated as unset.

  `searchWeb` (general) and `executeSearch` (news, for trend search) run on the
  active provider. `searchCompanies` / `describeCompanies` use Exa's company
  index and run only while Exa is the active provider; `companySearchAvailable()`
  says so. With any other provider, Prospects discovers companies through
  ordinary web search on that provider, and lookalikes are off.

- b08dc2a: Scenarios contract v2: durable, exactly-once runs and evidence-grounded people.
  - `@launchstack/pipelines/scenarios/v2`, plus its `db`, `engine`, `stages`,
    `graph-http` and `read` subpaths: a v2 run is a plan of units, each executed
    under a fenced lease.
    - A unit's outputs, its credit settlement and its journaled model replies
      commit in one transaction.
    - Acceptance, idempotency, the first hold and the dispatch outbox are one
      transaction.
    - Graph mode builds a Graphiti + Neo4j graph through the private
      `services/scenario-graph`.
    - Cast fields carry a basis (source, inferred, assumed, unknown) and
      evidence ids.
    - A finished run replays from its recorded turns with no model calls.
    - Contract v1 runs are unchanged.
  - `@launchstack/llm`: `resolveChatModel({ longWait: true })` sends a request
    through undici's own client, so a timeout longer than Node's five-minute
    limit on waiting for reply headers is honoured. `longWaitFetch` and
    `NODE_FETCH_HEADERS_TIMEOUT_MS` are exported.
  - `@launchstack/simulation`: a persona can carry its cast `slotId` and the
    facts it `knows`, and new model purposes cover the ontology, the cast plan
    and the attributed cast.

- 6296b88: Vantage: `undoDecision` takes back a decision just recorded — clears the
  topic's decision and removes the commitment it opened, in one transaction,
  and never removes a commitment opened from another topic. It backs the Undo
  on the web app's one-click Commit.
- f24eaba: Add Vantage, the weekly founder-meeting loop: an evidence inbox and dated
  metric observations go in; a draft agenda comes out whose every fact cites
  its source (the deployment's chat model when one is configured, deterministic
  rules otherwise); a recorded decision opens a commitment that next week's
  agenda checks. New subpaths `@launchstack/pipelines/vantage` and
  `@launchstack/pipelines/vantage/schema` (seven product tables), plus the
  shared-only weekly update renderer and CSV metric import.
- 967e3ea: Add the Google Drive connector to the connectors vertical: a thin Drive v3
  fetch client, Picker-scoped discovery/collect/sync under the `KnowledgeSink`
  contract, and export rules for Google-native files, exported at
  `@launchstack/pipelines/connectors/google-drive`. The shared connector
  contract widens `KnowledgeItem.content` to `string | Uint8Array` (with
  `contentByteLength`/`contentToBuffer` helpers) so remote connectors can carry
  binary formats; text-only sinks must narrow and reject bytes.

### Patch Changes

- fc83cb5: Gemini 3.8 Flash replaces the 2.5 family everywhere a model is defaulted.
  Google stopped serving `gemini-2.5-*` to new API keys, so a fresh deployment
  404'd on transcription, VLM enrichment, NER, reranking and table summaries.
  - `GEMINI_DEFAULT_MODEL` and `GEMINI_FAST_MODEL` are `gemini-3.8-flash` (there
    is no 3.8 Flash-Lite).
  - New preset `google/gemini-3.8-flash`, verified against Google's
    OpenAI-compatible endpoint. The `google/gemini-2.5-*` presets still resolve
    but are marked `deprecated`, and the config loader warns once naming the
    replacement.
  - The image tool defaults to `google/gemini-3.1-flash-image` (no 3.8 image
    model is published).

  Fixes found running the whole pipeline against Gemini:
  - Embeddings accept Gemini's response shape, which has no `usage` and omits a
    zero `index`; ingestion previously failed every batch against Gemini.
  - Structured output in `json-schema` mode sends a plain JSON Schema. LangChain
    used to hand the Zod schema to OpenAI's strict helper, which refuses any
    `.optional()` field that is not also `.nullable()` before a request is sent
    (the founder weekly review and the prospector's discovery plan). Literals go
    out as single-value `enum`s, because Gemini ignores `const`. When an endpoint
    refuses the schema with a 400, as Gemini does for one it judges too complex,
    the call is retried once without size bounds (Zod still enforces them), then
    falls back to the prompt-based JSON path.
  - Ingestion fetches root-relative `/api/files/{id}` references (audio
    transcripts, archive members) through the storage port instead of a bare
    `fetch`, which could not parse them.
  - The document converter's `/route` call is signed like `/convert`; unsigned it
    was a 401, so vision routing silently fell back to the default provider.

- 1977650: Add an internal draft Claim and ClaimVerdict contract for forthcoming proposal
  verification. This introduces no verifier, public package export, or runtime
  integration.
- 4f46119: Atomically claim proposal runs so concurrent deliveries do not repeat model work or credit debits. Lazily fail running jobs after 15 minutes from their start, preserve terminal states against late executors, and allow a fresh run without expiring queued work.

  Timeout updates also terminalize the run sheet atomically: running steps become failed with timeout details and completion timestamps, waiting steps are skipped, and completed step metadata and ordering remain unchanged.

  Restrict external admission/preparation and worker failure hooks to atomically failing unclaimed queued runs. They cannot cancel another delivery's running claim; the owning executor records its own failure, and orphaned running work expires after 15 minutes.

  Pass the finalization executor as the required second argument to `ProposalPorts.debitCredits`. The app meter now uses it for every credit query, including account provisioning, grants, ledger entries, and daily usage, so production metering and run completion commit or roll back together without acquiring another pool connection. Genuinely external credit sinks remain outside Postgres rollback guarantees.

- 9783fe1: Keep proposal generation within the stored run writer's current document scope.
  Inline and worker execution resolve active membership at execution time; a worker
  event cannot substitute a more privileged writer. Scope resolution failures do
  not fall back to workspace-wide access.

  Preserve AI-allowance admission and usage attribution when entering the current
  workspace model scope. Both document access and AI usage resolve to the stored
  writer; changing a worker event's user ID cannot redirect either.

  Require explicit document scope for run contexts, draft inputs, retrieval and
  organisation-profile loading. Filter profile provenance and library answers to
  readable same-workspace sources, check stored request sources, and refuse
  rewrite/review reuse of drafts backed by inaccessible evidence or saved answers.
  Rewrite and review continue to use existing evidence without fresh retrieval.

  Persist complete draft dependencies, including uncited retrieval and quoteless
  profile inputs. Preserve them through rewrites and manual edits; legacy generated
  prose without proof requires a redraft under constrained scopes.

  Store durable library-source snapshots in the existing evidence JSONB, with
  explicit provenance for new manual answers. Legacy evidence arrays remain
  readable/editable but are excluded from generation until replaced by a proven
  snapshot or an explicitly new manual entry. No SQL migration is required.

  Clearing text removes citation and gap annotations, not its source provenance.
  This prevents both false source attribution and accidental declassification when
  the author restores or replaces the text.

- 64bb234: Rename `@launchstack/search` to `@launchstack/retrieval` and consolidate
  every retrieval algorithm and tool into it, organized as one documented
  folder per algorithm: `algorithms/{bm25,vector,fusion,ensemble,rlm,graph,
reranking}` and `tools/{citation-builder,grounded-retrieval,rag-search-tool,
rlm-search}`. The RLM, graph, and ensemble retrievers move in from apps/web;
  the predictive-analysis ANN strategies become named modules behind the
  vector retriever; grounded-retrieval moves over from `@launchstack/tools`
  (a re-export keeps the old path). The `RagPort` contract is unchanged; the
  ensemble's env reads become `configureEnsemble()` injected by the
  composition root; old subpaths (`./retrievers`, `./reranking`,
  `./citation-builder`) survive one release as aliases. The old package name
  is lint-banned alongside the ADR-008 legacy names.
- 614e7d8: A scenario's subject can now be a few paragraphs (a plan, its actions and the
  current cases) without every turn repeating it. `buildBriefRequest` asks a
  subject longer than `TURN_SUBJECT_CHARS` (600) to be restated in at most 90
  words, `parseBrief` returns it as `Brief.situation`, and `turnSituation`
  picks what turns read: undefined for a short subject, else the restatement,
  else the subject's first 600 characters. `createWorld` takes it as
  `situation`, and `personaSystem` reads `World.situation` before
  `World.subject`; the brief, cast and report still read the whole subject.
  The pipelines brief schema gains `situation`, and runs pass the restatement
  into the world.
- 25c9232: Scenario crowds now behave like careful buyers. Every persona has a wallet
  (`currentSolution`, `budget`, `buyingRole`, `switchingCost`, `objection`), and
  a cast asks for a starting mix of stances (`REALISTIC_MIX`, 35% against);
  `skepticShortfall`, `seatsToRecast` and `fillSeats` let a host recast the
  missing skeptics when a cast comes back too warm, which scenario runs now do
  once (post tests, whose audience follows the brand, aim for 20% against). Turns weigh cost,
  switching and proof, and return `convincedBy`, `wouldPay` and `objection`.
  `runRound` applies `guardStance`: a stance moves at most
  `SimulationConfig.maxStanceStep` (1) per round, and a move toward the subject
  needs `convincedBy` to name a post from the agent's feed
  (`warmingNeedsReason`). Round summaries count `wouldPayCounts`, and the
  report and interviews read would-pay and objections. The pipelines' zod reply
  schemas mirror the new fields, with a test that they match the engine's.
- 3098860: `sourceKindOf` recognises a saved web page by its `ocrMetadata.kind = "website"`
  marker. Stored creation keys are hashed, so the `website:`/`crawl:` prefix
  check never matched and website sources were sorted as "other".
- Updated dependencies [eb91aa7]
- Updated dependencies [fafd939]
- Updated dependencies [c8750e4]
- Updated dependencies [1237451]
- Updated dependencies [9b0620b]
- Updated dependencies [3a4d012]
- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [1348cdb]
- Updated dependencies [ee41d64]
- Updated dependencies [bdabd2e]
- Updated dependencies [ba11446]
- Updated dependencies [7e1ab83]
- Updated dependencies [fc83cb5]
- Updated dependencies [290483e]
- Updated dependencies [8e2e7cc]
- Updated dependencies [64bb234]
- Updated dependencies [614e7d8]
- Updated dependencies [25c9232]
- Updated dependencies [b08dc2a]
- Updated dependencies [49a4fa5]
- Updated dependencies [52bab9f]
- Updated dependencies [f2ac582]
  - @launchstack/conversion@0.2.0
  - @launchstack/llm@0.2.0
  - @launchstack/tools@0.2.0
  - @launchstack/store@0.2.0
  - @launchstack/orchestration@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/indexing@0.2.0
  - @launchstack/retrieval@0.2.0
  - @launchstack/editing@0.2.0
  - @launchstack/engine@0.2.0
  - @launchstack/simulation@0.2.0
