# @launchstack/tools

## 0.2.0

### Minor Changes

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
- bdabd2e: Exa is the default web search engine. `searchCompanies` asks Exa's company
  index (`category: "company"`) for organisations matching a description,
  localised by country and never returning excluded hosts; `describeCompanies`
  reads what each company sells and to whom from its homepage, the query a
  lookalike search starts from; `companySearchAvailable()` says whether they can
  run (they need `EXA_API_KEY`). `executeSearch` (news, for trend search) now
  uses Serper when it is the only key.

  `fetchReadable` connects only to the addresses that passed its private-address
  check (adds `undici`), closing a DNS-rebinding gap, and exports `pinnedLookup`.
  `normalizeDomain` keeps a hosting platform's tenants apart
  (`freshfarm.myshopify.com`, `acme.github.io`), and grant search's web leg uses
  general web search instead of news.

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

- 52bab9f: Embeddings and paid web searches are counted alongside chat, so usage can be
  weighed in one unit.
  - `ChatUsageEvent` gains `kind` (`chat`, `embedding`, `web_search`,
    `web_contents`) and `calls` (searches made or pages read; 1 when absent).
  - New `reportUsage(event)` counts work that never passes the chat transport
    against the current chat scope's recorder. Outside a scope it does nothing;
    it never throws.
  - The embedding client reports every successful request with the provider's
    token count, or an estimate of four characters a token when the provider
    sends none (Gemini, Ollama, Hugging Face). `EmbeddingConfig.owner` and the
    effective config's `openAIOwner`, `huggingFaceOwner` and `ollamaOwner` say
    whether the deployment's endpoint or a workspace's own served it.
  - Web search reports each answered request: one search for Exa and Serper
    (general, news and company search), and the pages asked for when Exa reads
    company homepages. Failed requests report nothing.
  - Ingestion's embedding debit carries the embedding model in its metadata, so
    the host can price it.

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
- Updated dependencies [fafd939]
- Updated dependencies [c8750e4]
- Updated dependencies [1237451]
- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [ee41d64]
- Updated dependencies [ba11446]
- Updated dependencies [fc83cb5]
- Updated dependencies [64bb234]
- Updated dependencies [52bab9f]
- Updated dependencies [f2ac582]
  - @launchstack/llm@0.2.0
  - @launchstack/store@0.2.0
  - @launchstack/retrieval@0.2.0
