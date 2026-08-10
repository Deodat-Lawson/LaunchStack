import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

import { getWorkspaceSession } from "~/server/workspace/session";

/** Give up rather than hang the editor on a slow host. */
const FETCH_TIMEOUT_MS = 6000;

function absolute(base: string, href: string | undefined): string | null {
    if (!href) return null;
    try {
        return new URL(href, base).toString();
    } catch {
        return null;
    }
}

/**
 * Open Graph preview for the bookmark block. Failure is not an error: the
 * block still renders with the bare URL, which is what Notion does when a site
 * blocks scraping.
 */
export async function GET(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const raw = new URL(request.url).searchParams.get("url");
        if (!raw) return NextResponse.json({ error: "Missing url" }, { status: 400 });

        let target: URL;
        try {
            target = new URL(raw);
        } catch {
            return NextResponse.json({ error: "Invalid url" }, { status: 400 });
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
            return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
        }

        const fallback = {
            url: target.toString(),
            title: target.hostname,
            description: "",
            image: null as string | null,
            favicon: `https://www.google.com/s2/favicons?domain=${target.hostname}&sz=64`,
            siteName: target.hostname,
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let html: string;
        try {
            const response = await fetch(target, {
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (compatible; LaunchstackBot/1.0)" },
            });
            if (!response.ok) return NextResponse.json(fallback, { status: 200 });
            html = await response.text();
        } catch {
            return NextResponse.json(fallback, { status: 200 });
        } finally {
            clearTimeout(timer);
        }

        const $ = cheerio.load(html);
        const meta = (name: string): string | undefined =>
            $(`meta[property="${name}"]`).attr("content") ??
            $(`meta[name="${name}"]`).attr("content");

        return NextResponse.json(
            {
                url: target.toString(),
                title: meta("og:title") ?? $("title").first().text().trim() ?? fallback.title,
                description: meta("og:description") ?? meta("description") ?? "",
                image: absolute(target.toString(), meta("og:image")),
                favicon:
                    absolute(target.toString(), $('link[rel~="icon"]').first().attr("href")) ??
                    fallback.favicon,
                siteName: meta("og:site_name") ?? target.hostname,
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/bookmark] failed:", error);
        return NextResponse.json({ error: "Failed to fetch bookmark" }, { status: 500 });
    }
}
