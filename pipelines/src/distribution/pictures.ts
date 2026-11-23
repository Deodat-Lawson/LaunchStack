/**
 * A picture for every company found: what its own site declares (share image,
 * icon), else the site's own /favicon.ico. Read through the same guarded
 * reader as discovery, so no private address is ever fetched. Nothing is
 * guessed or taken from a third party: a site with none keeps none.
 */
import type { ReadablePage } from "@launchstack/tools/web-research";

import { mapInPool } from "./pool";
import * as db from "./db";

export interface CompanyPictures {
    imageUrl: string | null;
    iconUrl: string | null;
}

export type ReadPage = (url: string) => Promise<ReadablePage>;

/** The pictures `domain`'s homepage declares, else its /favicon.ico; null when it has none. */
export async function discoverPictures(
    domain: string,
    read: ReadPage
): Promise<CompanyPictures | null> {
    const home = await read(`https://${domain}/`).catch(() => null);
    const imageUrl = home?.image ?? null;
    let iconUrl = home?.icon ?? null;
    if (!imageUrl && !iconUrl) {
        const favicon = await read(`https://${domain}/favicon.ico`).catch(() => null);
        if (favicon && favicon.status < 400 && /^image\//i.test(favicon.contentType ?? ""))
            iconUrl = favicon.finalUrl;
    }
    return imageUrl || iconUrl ? { imageUrl, iconUrl } : null;
}

/** Sites without pictures are checked again after this long, not on every run. */
export const PICTURES_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fill in pictures for a workspace's companies that have a website and none
 * yet: at most `limit`, `concurrency` sites at a time. Every company checked
 * is stamped, found or not, so the next run moves on to others.
 */
export async function fillMissingPictures(
    companyId: bigint,
    read: ReadPage,
    options: { limit?: number; concurrency?: number; now?: Date } = {}
): Promise<{ checked: number; found: number }> {
    const now = options.now ?? new Date();
    const orgs = await db.listOrgsMissingPictures(companyId, {
        limit: options.limit ?? 60,
        checkedBefore: new Date(now.getTime() - PICTURES_RECHECK_MS),
    });
    let found = 0;
    await mapInPool(orgs, options.concurrency ?? 5, async org => {
        const pictures = org.domain ? await discoverPictures(org.domain, read) : null;
        if (pictures) found += 1;
        await db.updateOrg(org.id, companyId, { ...(pictures ?? {}), picturesCheckedAt: now });
    });
    return { checked: orgs.length, found };
}
