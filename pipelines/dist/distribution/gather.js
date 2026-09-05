/** The organisation half of a "Name | Tagline" page title. */
function firstSegment(title) {
    const head = title.split(/\s[|–—-]\s/)[0]?.trim();
    return head?.length ? head : title;
}
function hostOf(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return null;
    }
}
function guessRolesFromText(text) {
    const t = text.toLowerCase();
    const roles = [];
    if (/\b(importer|import\b|importeur|importador|importateur)/.test(t))
        roles.push("importer");
    if (/\b(distributor|distribution|vertrieb|distributeur|distribuidor|distributore)/.test(t))
        roles.push("distributor");
    if (/\b(wholesale|wholesaler|großhandel|grossist|groothandel|mayorista|grossiste)/.test(t))
        roles.push("wholesaler");
    if (/\b(retailer|retail|einzelhandel|winkel|tienda|boutique|store)\b/.test(t))
        roles.push("retailer");
    if (/\b(agent|agency|handelsvertreter|agente)\b/.test(t))
        roles.push("agent");
    return roles;
}
/**
 * Turn a web search result into a mention. The result's own site is the
 * organisation when the page is a company page; directory and press pages
 * become mentions of whoever they name in the title. Deciding that is the
 * enrich agent's job; here we record what we saw.
 */
export function mentionFromWebResult(result, query) {
    const host = hostOf(result.url);
    const trimmedTitle = result.title?.trim();
    const title = trimmedTitle?.length ? trimmedTitle : (host ?? result.url);
    const roles = guessRolesFromText(`${result.title} ${result.content.slice(0, 400)}`);
    return {
        name: firstSegment(title),
        url: result.url,
        country: query.territory.country,
        region: query.territory.region ?? null,
        roles: roles.length > 0 ? roles : [query.partnerKind],
        categories: [],
        description: result.content.slice(0, 280),
        source: `web:${query.label}`,
    };
}
export async function gather(plan, ports) {
    const webQueries = plan.filter(q => q.kind === "web");
    const placeQueries = plan.filter(q => q.kind === "place");
    const tradeQueries = plan.filter(q => q.kind === "trade");
    const mentions = [];
    const sources = [];
    let webResults = [];
    const tasks = [];
    // ── web ──
    tasks.push((async () => {
        if (webQueries.length === 0) {
            sources.push({
                source: "web",
                queries: 0,
                results: 0,
                status: "skipped",
                detail: "no web queries planned",
            });
            return;
        }
        if (!ports.searchWeb) {
            sources.push({
                source: "web",
                queries: webQueries.length,
                results: 0,
                status: "skipped",
                detail: "web search not configured",
            });
            return;
        }
        try {
            const results = await ports.searchWeb(webQueries);
            webResults = results;
            // Attribute each result to the first query whose territory it shares
            // (executeSearch dedupes across queries, so exact attribution is lost).
            const byCountry = new Map();
            for (const q of webQueries)
                if (!byCountry.has(q.territory.country))
                    byCountry.set(q.territory.country, q);
            const fallback = webQueries[0];
            for (const result of results) {
                const query = pickQueryForResult(result, webQueries) ?? fallback;
                mentions.push(mentionFromWebResult(result, query));
            }
            sources.push({
                source: "web",
                queries: webQueries.length,
                results: results.length,
                status: results.length > 0 ? "ok" : "degraded",
                detail: results.length > 0 ? undefined : "zero results",
            });
        }
        catch (error) {
            sources.push({
                source: "web",
                queries: webQueries.length,
                results: 0,
                status: "failed",
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    })());
    // ── places ──
    tasks.push((async () => {
        if (placeQueries.length === 0) {
            sources.push({
                source: "place",
                queries: 0,
                results: 0,
                status: "skipped",
                detail: "no place queries planned",
            });
            return;
        }
        if (!ports.searchPlaces) {
            sources.push({
                source: "place",
                queries: placeQueries.length,
                results: 0,
                status: "skipped",
                detail: "place search not configured",
            });
            return;
        }
        let total = 0;
        let failures = 0;
        for (const query of placeQueries) {
            if (ports.signal?.aborted)
                break;
            try {
                const places = await ports.searchPlaces(query);
                total += places.length;
                for (const place of places) {
                    mentions.push({
                        name: place.name,
                        url: place.website ?? null,
                        country: query.territory.country,
                        region: query.territory.region ?? null,
                        city: query.territory.region ?? null,
                        roles: [query.partnerKind],
                        categories: place.categories.map(c => c.name),
                        description: place.formattedAddress,
                        source: `place:${place.fsqId}`,
                    });
                }
            }
            catch (error) {
                failures += 1;
                console.warn("[distribution] place query failed:", query.query, error);
            }
        }
        const status = failures === placeQueries.length
            ? "failed"
            : failures > 0 || total === 0
                ? "degraded"
                : "ok";
        sources.push({
            source: "place",
            queries: placeQueries.length,
            results: total,
            status,
            detail: failures > 0 ? `${failures} queries failed` : undefined,
        });
    })());
    // ── trade ──
    tasks.push((async () => {
        if (!ports.tradeData) {
            sources.push({
                source: "trade",
                queries: tradeQueries.length,
                results: 0,
                status: "skipped",
                detail: "trade data not configured",
            });
            return;
        }
        const territories = new Map();
        for (const q of tradeQueries.length > 0 ? tradeQueries : plan)
            territories.set(q.territory.country, q.territory);
        let total = 0;
        let failures = 0;
        for (const [country, territory] of territories) {
            if (ports.signal?.aborted)
                break;
            const keywords = tradeQueries
                .filter(q => q.territory.country === country)
                .map(q => q.query);
            try {
                const records = await ports.tradeData.searchShipments({
                    country,
                    role: "importer",
                    hsCodes: ports.hsCodes,
                    keywords: ports.hsCodes.length > 0 ? undefined : keywords,
                    limit: 200,
                }, { signal: ports.signal });
                total += records.length;
                for (const record of records) {
                    mentions.push({
                        name: record.consignee,
                        country: record.consigneeCountry ?? territory.country,
                        roles: ["importer"],
                        categories: record.description ? [record.description.slice(0, 80)] : [],
                        description: `Imports from ${record.shipper}${record.shipperCountry ? ` (${record.shipperCountry})` : ""}${record.hsCode ? `, HS ${record.hsCode}` : ""}`,
                        source: `trade:${record.source}`,
                        url: record.sourceUrl ?? null,
                    });
                }
            }
            catch (error) {
                failures += 1;
                console.warn("[distribution] trade query failed:", country, error);
            }
        }
        const status = territories.size > 0 && failures === territories.size
            ? "failed"
            : failures > 0 || total === 0
                ? "degraded"
                : "ok";
        sources.push({
            source: "trade",
            queries: territories.size,
            results: total,
            status,
            detail: failures > 0 ? `${failures} territories failed` : undefined,
        });
    })());
    await Promise.allSettled(tasks);
    sources.sort((a, b) => a.source.localeCompare(b.source));
    return { mentions, sources, webResults };
}
function pickQueryForResult(result, queries) {
    const text = `${result.title} ${result.content}`.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const query of queries) {
        const terms = query.query
            .toLowerCase()
            .split(/\s+/)
            .filter(t => t.length > 3);
        const score = terms.filter(t => text.includes(t)).length;
        if (score > bestScore) {
            best = query;
            bestScore = score;
        }
    }
    return best;
}
//# sourceMappingURL=gather.js.map