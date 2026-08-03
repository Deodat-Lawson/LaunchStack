# Launchstack — Modular Architecture Overview

## Three-Layer Architecture

1. **Services Layer** — Vertical business modules
2. **Tools Layer** — Reusable AI capabilities
3. **Physical Layer** — Infrastructure, databases, hosting, storage

---

## Architecture Diagram

```mermaid
block-beta
  columns 9

  SLABEL["Services\nLayer"]:1
  MKT["Marketing Engine\n─────────────\nTrend Analysis\nContent Generation\nWeb Scraping Jobs"]:2
  LEG["Legal Services\n─────────────\nTemplate Library\nAuto-Fill & Clauses\nLegal Vault"]:2
  ONB["Employee Onboarding\n─────────────\nOnboarding Agent\nQuizzes & Checks\nProgress Tracking"]:2
  DOCR["Document Reasoning\n─────────────\nPage Index & TOC\nRLM Agent\nKnowledge Graph"]:2

  space:9

  TLABEL["Tools\nLayer"]:1
  RAG["RAG Pipeline\n(BM25 + Vector)"]:2
  WEB["Web Search\n(Exa, Firecrawl)"]:2
  REW["Doc Rewrite\n(Summarize, Refine)"]:2
  TMPL["Template Engine\n(Form → PDF)"]:2
  space:1
  ING["Doc Ingestion\n(OCR, Chunk, Embed)"]:4
  ENT["Entity Extraction\n(NER, Graph RAG)"]:4

  space:9

  PLABEL["Physical\nLayer"]:1
  DB["PostgreSQL + pgvector\n─────────────\nEmbeddings Index\nDocument Structure\nKnowledge Graph\nDomain Tables"]:2
  HOST["Hosting & Compute\n─────────────\nNext.js 15\nInngest Jobs\nAgent Hosting\nML Sidecar"]:2
  EXT["External Services\n─────────────\nOCR Providers\nFile Storage (S3)\nClerk Auth + RBAC"]:2
  KBS["Knowledge Bases\n─────────────\nCompany KB\nLegal Templates\nOnboarding Docs"]:2

  %% Service → Tool edges
  MKT --> RAG
  MKT --> WEB
  MKT --> REW
  LEG --> RAG
  LEG --> REW
  LEG --> TMPL
  ONB --> RAG
  ONB --> REW
  DOCR --> RAG
  DOCR --> WEB
  DOCR --> REW
  DOCR --> ING
  DOCR --> ENT

  %% Tool → Physical edges
  RAG --> DB
  RAG --> KBS
  WEB --> HOST
  REW --> HOST
  TMPL --> EXT
  TMPL --> KBS
  ING --> DB
  ING --> EXT
  ING --> HOST
  ENT --> DB
  ENT --> HOST

  classDef layer fill:#1a1a2e,color:#eee,stroke:none
  classDef svc fill:#4A90D9,color:#fff,stroke:#2C5F8A,stroke-width:1px
  classDef tool fill:#F5A623,color:#fff,stroke:#C47D0E,stroke-width:1px
  classDef phys fill:#27AE60,color:#fff,stroke:#1E8449,stroke-width:1px

  class SLABEL,TLABEL,PLABEL layer
  class MKT,LEG,ONB,DOCR svc
  class RAG,WEB,REW,TMPL,ING,ENT tool
  class DB,HOST,EXT,KBS phys
```

## Data Isolation

All services operate within domain-partitioned boundaries enforced by Clerk RBAC. RAG queries are scoped by `domain + company_id` — legal documents never surface in marketing queries.
