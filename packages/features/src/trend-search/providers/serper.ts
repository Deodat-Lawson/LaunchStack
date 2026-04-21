import type { RawSearchResult } from "../types";

const SERPER_NEWS_URL = "https://google.serper.dev/news";
const MAX_RESULTS_PER_QUERY = 10;

/** Response shape from Serper Google News API (subset we use). */
interface SerperNewsItem {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: string;
  position?: number;
}

interface SerperNewsResponse {
  news?: SerperNewsItem[];
}

/**
 * Calls Serper.dev Google News API for a single query.
 * @returns RawSearchResult[] or empty array if SERPER_API_KEY not set; throws on non-2xx.
 */
export async function callSerper(query: string): Promise<RawSearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[web-search] SERPER_API_KEY not set; skipping Serper search.");
    return [];
  }

  const response = await fetch(SERPER_NEWS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: MAX_RESULTS_PER_QUERY,
      gl: "us",
      hl: "en",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Serper API error: ${response.status} ${response.statusText}${
        text ? ` - ${text}` : ""
      }`,
    );
  }

  const data = (await response.json()) as SerperNewsResponse;
  const items = Array.isArray(data.news) ? data.news : [];
  if (items.length === 0) {
    console.warn("[web-search] Serper returned no news results.");
    return [];
  }

  const filtered = items.filter(
    (item): item is SerperNewsItem & { link: string } => Boolean(item?.link),
  );
  if (filtered.length === 0) {
    console.warn("[web-search] Serper returned no news results.");
    return [];
  }

  const total = filtered.length;

  return filtered.map((item, index) => {
    const position = index + 1;
    const score = Math.max(0, 1 - position / total);

    return {
      url: item.link,
      title: item.title ?? "Untitled",
      content: item.snippet ?? "",
      score,
      ...(item.date && { publishedDate: item.date }),
    };
  });
}
