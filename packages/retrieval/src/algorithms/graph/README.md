# graph — knowledge-graph traversal

**What it is.** One algorithm family, two backends. Query terms are matched
against extracted entities, the entity graph is traversed to pull in
co-occurring neighbours, and the sections those entities are mentioned in
become the leg's candidates. It finds connective context — sections that
never share the query's words but share its entities.

**Backends.**

- `neo4j.ts` — Cypher over the synced graph (`Entity`, `CO_OCCURS`,
  `MENTIONED_IN`): fuzzy entity match, 0–`maxHops` co-occurrence expansion,
  section IDs back to Postgres for the content. Requires the optional
  `neo4j-driver` peer and a configured connection
  (`@launchstack/indexing/knowledge-graph`, set up by the composition root).
- `pg.ts` — the same shape over the relational mirror (`kgEntities`,
  `kgEntityMentions`) when Neo4j is absent.

`shouldUseNeo4jRetriever()` picks the backend; whether the graph leg runs at
all is the ensemble config's `graphRetrieval` flag.

**Failure.** Both backends degrade to zero candidates — a down peer never
fails a search, it just thins it. The ensemble's leg-breakdown log is where
a permanently silent graph leg shows up.

**When it wins.** Entity-bridging questions ("what connects X and Y",
policies referenced across documents). It contributes noise on purely
lexical or purely semantic queries, which is why its default weight is the
smallest of the three legs.
