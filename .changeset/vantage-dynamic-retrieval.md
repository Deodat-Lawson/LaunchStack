---
"@launchstack/pipelines": minor
"@launchstack/retrieval": patch
---

Add the proposed Vantage V0 deterministic retrieval provider and bounded context
research planner, with optional injected search tools and a synthetic demo. Preserve
document version and parent-chunk metadata through the app RAG port so source
adapters can retain exact citation identity. Production provider registration is
left to the host application; the frozen V1 generation contract is unchanged.
