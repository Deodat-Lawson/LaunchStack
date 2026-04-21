import { buildReferences, extractRecommendedPages } from "~/app/api/agents/documentQ&A/services/references";
import type { SearchResult } from "~/lib/tools/rag";

describe("references service", () => {
  it("extracts sorted unique recommended pages and ignores invalid values", () => {
    const docs: SearchResult[] = [
      { pageContent: "A", metadata: { searchScope: "document", page: 3 } },
      { pageContent: "B", metadata: { searchScope: "document", page: 1 } },
      { pageContent: "C", metadata: { searchScope: "document", page: 3 } },
      { pageContent: "D", metadata: { searchScope: "document", page: 0 } },
      { pageContent: "E", metadata: { searchScope: "document" } },
    ];

    expect(extractRecommendedPages(docs)).toEqual([1, 3]);
  });

  it("builds query-aware snippets using childContent when available", () => {
    const docs: SearchResult[] = [
      {
        pageContent: "General parent content that does not include the key phrase.",
        metadata: {
          searchScope: "document",
          chunkId: 11,
          page: 4,
          documentId: 99,
          documentTitle: "Policy Handbook",
          source: "vector_ann",
          childContent: "Vacation policy states employees receive 15 days paid time off annually.",
        } as SearchResult["metadata"] & { childContent: string },
      },
    ];

    const refs = buildReferences("How many vacation days do employees receive?", docs);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.page).toBe(4);
    expect(refs[0]?.documentTitle).toBe("Policy Handbook");
    expect(refs[0]?.snippet.toLowerCase()).toContain("vacation");
  });

  it("falls back to prefix snippet and omits invalid page numbers", () => {
    const docs: SearchResult[] = [
      {
        pageContent:
          "This section explains onboarding procedures and account setup for new hires in detail.",
        metadata: {
          searchScope: "document",
          page: 0,
          documentId: 10,
        },
      },
    ];

    const refs = buildReferences("What is covered here?", docs);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.page).toBeUndefined();
    expect(refs[0]?.snippet.length).toBeGreaterThan(20);
  });
});
