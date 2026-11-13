/**
 * `sources` — capture what the run reads, once. The host's collector reads
 * every selected source as the creator may see it; this stage ranks the
 * sections, holds them to the source budget (recording every cut), numbers
 * them E1…, hashes each quote and the whole manifest, and writes the manifest
 * every later unit, replay and report read instead of the live sources.
 * No model calls.
 */
import { clip } from "@launchstack/simulation";

import type { SourceBudget, SourceManifest, SourceOmission } from "../contracts";
import { approxTokens, hashOf, sha256Hex } from "../hash";
import type { SourceCollection, SourceSectionDraft, Stage } from "../stage";
import { toStoredEvidence } from "./common";

function documentKey(s: SourceSectionDraft): string | null {
    if (s.sourceType !== "document" && s.sourceType !== "search") return null;
    const id = s.documentIds[0] ?? s.locator.documentId;
    return id != null ? `doc:${id}` : `doc:${s.sourceId}`;
}

/** Sections of one document compete with each other; other sources compete by type. */
function groupKey(s: SourceSectionDraft): string {
    return documentKey(s) ?? s.sourceType;
}

/**
 * Rank-major order: every group's best section, then every group's second,
 * and so on, so a budget cut trims the weakest sections rather than whole
 * sources. Within a group, higher score first; ties keep the collector's order.
 */
export function rankSections(sections: SourceSectionDraft[]): SourceSectionDraft[] {
    const groups = new Map<string, Array<{ s: SourceSectionDraft; i: number }>>();
    sections.forEach((s, i) => {
        const key = groupKey(s);
        groups.set(key, [...(groups.get(key) ?? []), { s, i }]);
    });
    const ordered = [...groups.values()].map(list =>
        list.sort((a, b) => b.s.score - a.s.score || a.i - b.i).map(x => x.s)
    );
    const out: SourceSectionDraft[] = [];
    const deepest = Math.max(0, ...ordered.map(g => g.length));
    for (let rank = 0; rank < deepest; rank++) {
        for (const group of ordered) {
            const next = group[rank];
            if (next) out.push(next);
        }
    }
    return out;
}

/**
 * Turn a collection into the run's manifest. Pure: the same collection,
 * budget and capture time give the same manifest and hash.
 */
export function finalizeManifest(
    collection: SourceCollection,
    budget: SourceBudget,
    options: { collector: string; capturedAt: Date }
): SourceManifest {
    // Drop empty text and exact repeats from the same source.
    const seen = new Set<string>();
    const clean: SourceSectionDraft[] = [];
    for (const s of collection.sections) {
        const text = s.text.trim();
        if (!text) continue;
        const key = `${s.sourceType}|${s.sourceId}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        clean.push({ ...s, text });
    }

    const omissions: SourceOmission[] = [...collection.omissions];
    const kept: SourceSectionDraft[] = [];
    const perDocument = new Map<string, number>();
    let total = 0;
    for (const s of rankSections(clean)) {
        const tokens = approxTokens(s.text);
        const doc = documentKey(s);
        const docUsed = doc ? (perDocument.get(doc) ?? 0) : 0;
        const fits =
            kept.length < budget.maxSections &&
            total + tokens <= budget.totalTokens &&
            (!doc || docUsed + tokens <= budget.perDocumentTokens);
        if (!fits) {
            omissions.push({
                sourceType: s.sourceType,
                sourceId: s.sourceId,
                label: s.label,
                reason: "budget",
                tokens,
            });
            continue;
        }
        kept.push(s);
        total += tokens;
        if (doc) perDocument.set(doc, docUsed + tokens);
    }

    const capturedAt = options.capturedAt.toISOString();
    const items = kept.map((s, i) => ({
        id: `E${i + 1}`,
        kind: s.kind,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
        versionId: s.versionId,
        label: clip(s.label, 140),
        locator: s.locator,
        quote: s.text,
        fact: s.fact,
        contentHash: sha256Hex(s.text),
        capturedAt,
        validity: s.validity,
        documentIds: [...new Set(s.documentIds)].sort((a, b) => a - b),
        href: s.href,
        tokens: approxTokens(s.text),
    }));
    const documentIds = [...new Set(items.flatMap(i => i.documentIds))].sort((a, b) => a - b);
    // What the evidence is, not when it was read: two runs over the same
    // sources share a manifest hash, and with it a graph build.
    const manifestHash = hashOf(
        items.map(i => ({
            id: i.id,
            kind: i.kind,
            sourceType: i.sourceType,
            sourceId: i.sourceId,
            versionId: i.versionId,
            locator: i.locator,
            contentHash: i.contentHash,
        }))
    );
    return {
        version: 1,
        collector: options.collector,
        items,
        omissions,
        budget,
        usedTokens: total,
        documentIds,
        manifestHash,
    };
}

/** Sources with at least one omission: what "selected but not fully read" counts. */
export function omittedSourceCount(omissions: SourceOmission[]): number {
    return new Set(omissions.map(o => `${o.sourceType}|${o.sourceId}`)).size;
}

export const sourcesStage: Stage = async ctx => {
    const collection = await ctx.ports.collectSources(ctx.run, ctx.spec);
    const manifest = finalizeManifest(collection, ctx.spec.policies.sourceBudget, {
        collector: ctx.spec.policies.versions.sourceCollector,
        capturedAt: ctx.ports.now(),
    });
    ctx.ports.log?.("scenario sources captured", {
        runId: ctx.run.id,
        items: manifest.items.length,
        omissions: manifest.omissions.length,
        tokens: manifest.usedTokens,
    });
    return {
        output: {
            manifestHash: manifest.manifestHash,
            items: manifest.items.length,
            omissions: manifest.omissions.length,
            usedTokens: manifest.usedTokens,
        },
        writes: [{ type: "source_manifest", manifest }],
        run: {
            evidence: manifest.items.map(toStoredEvidence),
            flags: { omittedSources: omittedSourceCount(manifest.omissions) },
        },
    };
};
