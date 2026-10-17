/**
 * Brand post tests: hashing the tested draft, reading a post's real
 * engagement, and the track record that compares the two.
 */
import { createHash } from "node:crypto";

import { directionHits, spearman } from "@launchstack/simulation";

import type { BrandPostMetrics } from "../marketing/schema";
import type { LinkedPostTest } from "./db";

/** Results needed before rank agreement is shown. */
export const TRACK_RECORD_MINIMUM = 5;

/** Same normalization as the client's `normalizeDraft`. */
export function normalizeDraft(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

export function hashDraft(text: string): string {
    return createHash("sha256").update(normalizeDraft(text)).digest("hex");
}

/**
 * A post's real engagement rate, 0–1: the network's own figure when it
 * reports one, otherwise (reactions + comments + shares) / impressions.
 * Null until impressions are known — counts alone can't be compared across
 * posts with different reach.
 */
export function actualEngagement(metrics: BrandPostMetrics | null): number | null {
    if (!metrics) return null;
    if (typeof metrics.engagement === "number" && Number.isFinite(metrics.engagement)) {
        return Math.max(0, Math.min(1, metrics.engagement));
    }
    if (metrics.impressions && metrics.impressions > 0) {
        const engaged = metrics.reactions + metrics.comments + metrics.shares;
        return Math.max(0, Math.min(1, engaged / metrics.impressions));
    }
    return null;
}

export interface TrackRecordRow {
    runId: number;
    postId: string;
    network: string;
    publishedAt: string | null;
    text: string;
    predicted: number;
    actual: number | null;
}

export interface TrackRecord {
    tested: number;
    withResults: number;
    minimum: number;
    spearman: number | null;
    hits: number;
    total: number;
    rows: TrackRecordRow[];
}

export function buildTrackRecord(linked: LinkedPostTest[]): TrackRecord {
    const rows: TrackRecordRow[] = linked
        .filter(l => l.predicted !== null)
        .map(l => ({
            runId: l.runId,
            postId: l.brandPostId,
            network: l.platform,
            publishedAt: l.publishedAt ? l.publishedAt.toISOString() : null,
            text: l.body.length > 280 ? `${l.body.slice(0, 279)}…` : l.body,
            predicted: l.predicted!,
            actual: l.status === "published" ? actualEngagement(l.metrics) : null,
        }));
    const scored = rows.filter(r => r.actual !== null);
    const enough = scored.length >= TRACK_RECORD_MINIMUM;
    const predicted = scored.map(r => r.predicted);
    const actual = scored.map(r => r.actual!);
    const direction = enough ? directionHits(predicted, actual) : { hits: 0, total: 0 };
    return {
        tested: rows.length,
        withResults: scored.length,
        minimum: TRACK_RECORD_MINIMUM,
        spearman: enough ? (spearman(predicted, actual) ?? null) : null,
        hits: direction.hits,
        total: direction.total,
        rows,
    };
}
