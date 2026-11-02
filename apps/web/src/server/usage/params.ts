/**
 * What a `/api/usage/*` query string may say, read once for every route. A
 * route takes the fields it serves and ignores the rest; anything malformed is
 * a 400 `WorkspaceError`, so the route's one catch answers it. The window's
 * wording is `parseUsageWindow`'s; the rest is developer-facing (the tab never
 * builds a bad query), worded like it.
 */

import { copy } from "~/i18n/copy";
import { isAiFeature, type AiFeature } from "~/lib/ai-usage";
import { parseUsageWindow } from "~/lib/usage/range";
import type { UsageWindow } from "~/lib/usage/types";
import { badRequest } from "~/server/workspace/errors";
import { parseIdParam } from "~/server/workspace/http";

export interface UsageQuery {
    window: UsageWindow;
    /** A workspace member id (`MemberView.id`). */
    person: number | null;
    /** A workspace group id. */
    group: number | null;
    feature: AiFeature | null;
    offset: number;
    limit: number;
}

export interface PageLimits {
    defaultLimit: number;
    maxLimit: number;
}

const ACTIVITY_PAGE: PageLimits = { defaultLimit: 100, maxLimit: 500 };

function optionalId(params: URLSearchParams, name: string): number | null {
    const raw = params.get(name);
    if (raw === null || raw === "") return null;
    const id = parseIdParam(raw);
    if (id === null) throw badRequest(copy("errors.api.invalidId"));
    return id;
}

function wholeNumber(
    params: URLSearchParams,
    name: string,
    fallback: number,
    min: number,
    max: number
): number {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw badRequest(`${name} must be a whole number from ${min} to ${max}`);
    }
    return value;
}

export function readUsageQuery(
    params: URLSearchParams,
    page: PageLimits = ACTIVITY_PAGE,
    now: Date = new Date()
): UsageQuery {
    const parsed = parseUsageWindow(params, now);
    if (!parsed.ok) throw badRequest(parsed.error);

    const person = optionalId(params, "person");
    const group = optionalId(params, "group");
    if (person !== null && group !== null) {
        throw badRequest("person and group can't be combined");
    }

    const rawFeature = params.get("feature");
    let feature: AiFeature | null = null;
    if (rawFeature !== null && rawFeature !== "") {
        if (!isAiFeature(rawFeature)) throw badRequest(`unknown feature "${rawFeature}"`);
        feature = rawFeature;
    }

    return {
        window: parsed.window,
        person,
        group,
        feature,
        offset: wholeNumber(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
        limit: wholeNumber(params, "limit", page.defaultLimit, 1, page.maxLimit),
    };
}

/** The documents list: the most opened 200 by default, at most 1,000. */
export const DOCUMENTS_PAGE: PageLimits = { defaultLimit: 200, maxLimit: 1000 };
