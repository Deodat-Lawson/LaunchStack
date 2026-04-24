import type { RawSearchResult } from "../types";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_RESULTS_PER_QUERY = 10;

interface ExaResultItem {
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  publishedDate?: string;
}

interface ExaSearchResponse {
  results?: ExaResultItem[];
}

/**
 * Calls Exa search API for a single query. Uses `auto` search type (hybrid
 * neural + keyword) with the `news` category and full text contents so results
 * are directly usable for grounding.
 */
export async function callExa(query: string): Promise<RawSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.warn("[web-search] EXA_API_KEY not set; skipping Exa search.");
    return [];
  }

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      category: "news",
      numResults: MAX_RESULTS_PER_QUERY,
      contents: {
        text: true,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Exa API error: ${response.status} ${response.statusText}${
        text ? ` - ${text}` : ""
      }`,
    );
  }

  const data = (await response.json()) as ExaSearchResponse;
  if (!data.results || !Array.isArray(data.results)) {
    return [];
  }

  return data.results
    .filter(
      (item): item is ExaResultItem & { url: string } => Boolean(item?.url),
    )
    .map((item) => ({
      url: item.url,
      title: item.title ?? "Untitled",
      content: item.text ?? "",
      score: typeof item.score === "number" ? item.score : 0,
      ...(item.publishedDate != null && { publishedDate: item.publishedDate }),
    }));
}
