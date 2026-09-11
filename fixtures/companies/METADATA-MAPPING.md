# Company fixture → production metadata mapping

How each synthetic company fixture corresponds to the metadata the Campaign Planner
actually reads in production.

## The production schema being mapped to

Two layers, both real:

**Table** — `pdr_ai_v2_company_metadata` (`packages/core/src/db/schema/company-metadata.ts`).
All Drizzle tables pass through `pgTableCreator(name => \`pdr_ai_v2_${name}\`)`, so the
declared name `company_metadata` becomes `pdr_ai_v2_company_metadata` in Postgres.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `company_id` | bigint, FK → `company.id`, unique | one metadata row per company |
| `schema_version` | varchar(20), default `'1.0.0'` | |
| `metadata` | **jsonb, not null** | holds the entire `CompanyMetadataJSON` document |
| `last_extraction_document_id` | bigint, FK → `document.id` | |
| `created_at` / `updated_at` | timestamptz | |

**JSON document** — `CompanyMetadataJSON` (`packages/features/src/company-metadata/types.ts`).
Every leaf value is wrapped in a `MetadataFact<T>`:

```ts
interface MetadataFact<T = string> {
    value: T;
    visibility: "public" | "partner" | "private" | "internal";
    usage: "outreach_ok" | "outreach_ok_with_approval" | "no_outreach";
    confidence: number;          // 0.0 – 1.0
    priority: "manual_override" | "high" | "normal" | "low";
    status: "active" | "deprecated" | "superseded";
    last_updated: string;        // ISO 8601
    sources: MetadataSource[];   // { doc_id, doc_name, extracted_at, page?, snippet_ref? }
}
```

**How the pipeline reads it.** `buildMetadataContext` in the marketing pipeline's `context.ts`
filters every fact through `readFact`, which drops a fact unless
`status === "active"` **and** `confidence >= 0.5` (`MIN_CONFIDENCE`). Facts below that
threshold are invisible to generation even though they exist in the column.

## Field-by-field mapping

`CompanyMetadataJSON` path → fixture source. `MetadataFact` wrapper fields are listed once
at the end rather than repeated for every row.

| Metadata field | Fixture source | Meridian | Fernwood | Northwind | Tilde |
|---|---|---|---|---|---|
| `company.name` | `company.json` → `name` | Meridian Rail Systems | Fernwood Audio | Northwind Cold Chain | Tilde Labs |
| `company.description` | `company.json` → `summary` | Scheduling and yard-management software for short-line and regional freight railroads | Portable field recorders and companion software for location sound | Temperature-monitoring hardware and reporting software for chilled and frozen food logistics | **null** — no positioning exists |
| `company.industry` | `company.json` → `industry` | Freight rail operations software | Professional and prosumer audio hardware | Cold-chain monitoring for food logistics | **null** |
| `company.founded_year` | `company.json` → `foundedYear` | 2016 | 2019 | 2014 | **null** |
| `company.headquarters` | `company.json` → `headquarters` | Duluth, Minnesota, United States | Bristol, United Kingdom | Leeds, United Kingdom | **null** |
| `company.size` | `company.json` → `size` | 61 employees | 24 employees | 112 employees | **null** |
| `company.website` | `company.json` → `website` | `meridianrail.example` | `fernwoodaudio.example` | `northwindcoldchain.example` | **null** |
| `services[].name` | `company.json` → `products[].name` | Meridian Dispatch, Meridian Yard | Fernwood FR-2, Fernwood Studio | Northwind NW-40, Northwind Records | Tilde CLI |
| `services[].description` | `company.json` → `products[].description` | populated | populated | populated | vague by design |
| `services[].status` | not modelled in fixtures | — | — | — | — |
| `people[].name` | `company.json` → `people[].name` | Dolores Whitcomb, Amos Petrakis | Rosalind Achebe | Ingrid Halvorsen | **empty** |
| `people[].role` | `company.json` → `people[].role` | populated | populated | populated | **empty** |
| `people[].email` / `.phone` / `.department` | not modelled — see gaps | — | — | — | — |
| `markets.primary[]` | `company.json` → `markets.primary` | Short-line / regional freight railroads | Location sound recording, field recording | Chilled / frozen food logistics | **empty** |
| `markets.verticals[]` | `company.json` → `markets.verticals` | Freight rail, terminal and switching | Documentary, podcasting, nature, foley | Food and beverage, 3PL | **empty** |
| `markets.geographies[]` | `company.json` → `markets.geographies` | United States, Canada | UK, EU, US | UK, Ireland, Netherlands | **empty** |
| `projects[]` | not modelled — see gaps | — | — | — | — |
| `policies{}` | `company.json` → `certifications[]` | SOC 2 Type II | **empty** | ISO 9001:2015, ISO/IEC 27001:2022 | **empty** |
| `legal[]` | not modelled — see gaps | — | — | — | — |
| `provenance.total_documents_processed` | count of `documents[]` | 4 | 2 | 1 | 1 |
| `provenance.last_document_processed` | not modelled — see gaps | — | — | — | — |
| `provenance.extraction_model` | not modelled — fixtures are hand-authored | — | — | — | — |
| `schema_version` | not modelled — fixtures carry no version | — | — | — | — |

### MetadataFact wrapper fields

Fixtures do **not** reproduce the fact wrapper. Every fixture value is the equivalent of a
fact with `status: "active"`, `confidence: 1.0`, `priority: "normal"`. When a fixture value is
loaded into a metadata-shaped document, wrap it accordingly:

| Wrapper field | Fixture equivalent |
|---|---|
| `value` | the fixture value itself |
| `confidence` | not modelled — assume `1.0` so `readFact` admits it |
| `status` | not modelled — assume `"active"` |
| `sources[].doc_id` | not modelled — fixtures identify documents by path, not numeric id |
| `sources[].doc_name` | `sourceFacts[].provenance[].document` |
| `sources[].page` | not modelled — fixture documents are Markdown, unpaginated |
| `visibility`, `usage`, `priority`, `last_updated`, `valid_from`, `valid_to` | not modelled |

## Fields that exist in one representation but not the other

Listing these explicitly, per the brief's requirement not to invent fields.

### In production metadata, absent from fixtures

| Production field | Why it is absent |
|---|---|
| `projects[]` and `projects[].subprojects[]` | None of the four archetypes needed project-level structure to exercise a deterministic criterion. Meridian's case study is closer to a `project` than a `service`, but it is modelled as a document so its provenance quotes stay checkable. |
| `legal[]` | Northwind is the natural candidate, but modelling contracts and effective dates would add regulated claim surface without adding a deterministic check. Its compliance content is modelled as `certifications` plus a document instead. |
| `people[].email`, `.phone`, `.department` | Synthetic contact details would be dead weight, and email/phone are exactly the fields `filterContent`'s PII detection flags. Deliberately omitted. |
| `MetadataFact` wrapper (all fields) | Fixtures are flat values. This is the single largest structural difference — see the confidence-threshold note below. |
| `provenance.extraction_model` / `.extraction_version` | Fixtures are hand-authored, not extracted, so there is no model to record. |
| `derived_views` | Unused by the marketing pipeline. |
| `schema_version` | Fixtures are not versioned. |

### In fixtures, absent from production metadata

| Fixture field | Why production has no equivalent |
|---|---|
| `sourceFacts[]` with `kind` (`supported` / `contradictory` / `distractor`) | **No production counterpart at all.** Production metadata stores only facts believed true; it has no representation for a deliberately false or deliberately irrelevant fact. This is purely an evaluation construct and is the mechanism behind every grounding criterion. |
| `knowledgeDepth` | Evaluation-only. Production infers sparseness implicitly — `extractCompanyDNA` falls back from metadata to RAG when no row exists. |
| `archetype` | Evaluation-only; documents what the fixture is *for*. |
| `products[].limitations` | Production has no field for honest product limits. Notable, since limitation-respecting is one of the more valuable things to evaluate. |
| `products[].capabilities` / `.integrations` | Would collapse into `services[].description` prose in production; kept structured here so criteria can check them individually. |
| `prohibitedCompetitors` | No production equivalent. The live pipeline's `analyzeCompetitors` *discovers* competitors from web search rather than reading a prohibition list. |
| `allowedProductNames` | No production equivalent. Needed so `no-hallucinated-product-names` has an allow-list to compare against. |
| `brandVoice` | Production derives brand voice at runtime via `extractBrandVoice` (RAG + LLM) rather than storing it. Fixtures state it directly so voice-adjacent deterministic checks (forbidden vocabulary) are stable. |
| `audiences[]` | Production derives a persona at runtime via `extractTargetPersona`, gated on a `targetAudience` request field. Not stored. |
| `differentiators` / `proofPoints` | Production synthesises these into `CompanyDNA` at runtime (`keyDifferentiators`, `provenResults`); they are not persisted. |
| `documents[]` metadata (`kind`, `summary`) | Production has a `document` table, but the classification vocabulary used here (`brand_voice`, `campaign_brief`, …) is fixture-specific. |

## Consequences worth knowing

**The confidence threshold is not exercised by these fixtures.** Because fixture values carry
no `confidence`, loading them as metadata means every fact clears `MIN_CONFIDENCE = 0.5`.
Production behaviour where a fact exists but is suppressed for low confidence is therefore
*not* covered here. Worth noting because there is a real edge case behind it: if a company has
a metadata row where every fact scores below 0.5, `buildMetadataContext` returns a
header-only string, which still counts as truthy — so the RAG fallback never fires and
generation proceeds on almost no context.

**`sourceFacts` has no production home.** If contradiction-resistance ever needs measuring
against live data rather than fixtures, there is nowhere in `CompanyMetadataJSON` to record
"this claim is false". That would need a schema addition, not a fixture change.

**Fixture documents are Markdown; production documents are chunked and embedded.** Fixtures
address documents by relative path (`docs/product-guide.md`); production addresses them by
`doc_id` with a `page` number. Provenance is therefore checkable in fixtures by exact quote
matching, and checkable in production only by chunk retrieval.
