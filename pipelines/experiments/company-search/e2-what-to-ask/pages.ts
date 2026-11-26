/**
 * One search word's pages, recorded: the register's name search is asked
 * page by page until it runs out or the page limit is reached.
 *
 * A page whose request gets no answer ends the word's recording and marks it
 * `cutShort`: its recorded pages are then not the whole answer, so the word
 * is never complete (see ./env.ts). No answer is not an empty page.
 */
import {
    answered,
    exchangeWithRetries,
    failureDetail,
    type ExchangeSource,
    type RetryOptions,
} from "../lib/recorder";
import { PAGE_SIZE, searchUrl, type Company } from "./world";

export interface RegisterPage {
    _embedded?: {
        enheter?: Array<{
            organisasjonsnummer: string;
            navn: string;
            naeringskode1?: { kode: string };
        }>;
    };
    page?: { totalElements: number; totalPages: number };
}

export function rows(page: RegisterPage): Company[] {
    return (page._embedded?.enheter ?? []).map(e => ({
        id: e.organisasjonsnummer,
        name: e.navn,
        code: e.naeringskode1?.kode ?? null,
    }));
}

export interface RecordedTerm {
    pages: Company[][];
    /** Matches the register reports for the word, from the last page that answered. */
    total: number;
    /** Pages that answered. */
    requests: number;
    /** True when a page got no answer, so `pages` stops short of what was asked. */
    cutShort: boolean;
}

/**
 * Up to `maxPages` pages of the name search for one word. While recording, a
 * page that gets no answer is asked again (see `exchangeWithRetries`); a
 * request that was never recorded throws.
 */
export async function recordTerm(
    term: string,
    source: ExchangeSource,
    maxPages: number,
    retry: RetryOptions = {}
): Promise<RecordedTerm> {
    const pages: Company[][] = [];
    let total = 0;
    let requests = 0;
    for (let page = 0; page < maxPages; page++) {
        const exchange = await exchangeWithRetries(source, searchUrl(term, page), {
            onFailure: (failed, attempt, attempts) =>
                console.warn(
                    `  search gave no answer for "${term}" page ${page} (try ${attempt} of ${attempts}): ${failureDetail(failed)}`
                ),
            ...retry,
        });
        if (!answered(exchange)) return { pages, total, requests, cutShort: true };
        const json = JSON.parse(exchange.body) as RegisterPage;
        requests += 1;
        const found = rows(json);
        total = json.page?.totalElements ?? total;
        pages.push(found);
        if (found.length < PAGE_SIZE || page + 1 >= (json.page?.totalPages ?? 0)) break;
    }
    return { pages, total, requests, cutShort: false };
}
