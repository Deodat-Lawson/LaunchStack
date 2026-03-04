import { env } from "~/env";
import type { RawSearchResult } from "~/lib/tools/trend-search/types";

const SERPER_NEWS_URL = "https://google.serper.dev/news";

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

export async function callSerper(query: string): Promise<RawSearchResult[]> {
  const apiKey = env.server.SERPER_API_KEY;
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
      num: 10,
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

  const total = items.length;

  return items
    .filter((item): item is SerperNewsItem & { link: string } =>
      Boolean(item?.link),
    )
    .map((item, index) => {
      const position =
        typeof item.position === "number" && item.position > 0
          ? item.position
          : index + 1;
      const score = 1 - position / (total + 1);

      return {
        url: item.link,
        title: item.title ?? "Untitled",
        content: item.snippet ?? "",
        score,
        ...(item.date && { publishedDate: item.date }),
      };
    });
}

