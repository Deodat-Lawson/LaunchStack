# Architecture diagram rules

- Use `flowchart TD` (not `graph`).
- Include 8–15 nodes MAXIMUM. Each node is a logical MODULE or LAYER, not an
  individual file. Group related files into one node (e.g. "API Routes", not
  "route1.ts, route2.ts, route3.ts").
- Add short edge labels (2–3 words): `A -->|"calls"| B`.
- Use subgraphs for layers (Frontend, Backend, Database, …). Nested
  subgraphs are allowed and encouraged for clarity:

  ```
  subgraph Backend
    subgraph API
      A["Routes"]
      B["Middleware"]
    end
    subgraph Services
      C["Auth"]
      D["Storage"]
    end
  end
  ```

- Every subgraph MUST be closed with `end`.
- Use simple node IDs (A, B, C, …, Z, AA, AB). No spaces in IDs.
- Labels in quotes: `A["Auth Service"]`.
- One statement per line.
- KEEP IT SIMPLE — a readable diagram with 10 clear nodes is better than a
  cluttered one with 30.
