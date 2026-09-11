# Component diagram rules

- Use `flowchart TD` (not `graph`).
- Show 8–15 key components/modules.
- Use subgraphs to group related components. Nested subgraphs are allowed:

  ```
  subgraph Frontend
    subgraph Pages
      A["Dashboard"]
      B["Settings"]
    end
  end
  ```

- Add edge labels: "imports", "calls", "emits", "subscribes".
- Every subgraph MUST be closed with `end`.
- Use simple node IDs (A, B, C, …, Z, AA, AB). No spaces in IDs.
- Labels in quotes: `A["ComponentName"]`.
- One statement per line.
- KEEP IT SIMPLE — clarity over completeness.
