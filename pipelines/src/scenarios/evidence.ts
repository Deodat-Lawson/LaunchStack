/**
 * Turning raw records into the numbered evidence a cast cites. The host
 * collects drafts from each source (files the creator can see, prospects,
 * comments, the company profile, pasted notes); this keeps every source
 * represented, drops duplicates, clips long text and numbers the result.
 */
import { clip } from "@launchstack/simulation";

import type { EvidenceKind, StoredEvidence } from "./types";

export interface EvidenceDraft {
    kind: EvidenceKind;
    label: string;
    text: string;
    ref: { type: string; id: string };
    href: string | null;
}

export function buildEvidence(
    drafts: EvidenceDraft[],
    options: { max?: number; maxChars?: number } = {}
): StoredEvidence[] {
    const max = options.max ?? 40;
    const maxChars = options.maxChars ?? 700;
    const seen = new Set<string>();
    const byKind = new Map<EvidenceKind, EvidenceDraft[]>();
    for (const d of drafts) {
        const text = d.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const key = `${d.ref.type}:${d.ref.id}:${text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = byKind.get(d.kind) ?? [];
        list.push({ ...d, text });
        byKind.set(d.kind, list);
    }
    // Round-robin across sources so one big source can't crowd out the rest.
    const queues = [...byKind.values()];
    const picked: EvidenceDraft[] = [];
    while (picked.length < max && queues.some(q => q.length > 0)) {
        for (const q of queues) {
            const next = q.shift();
            if (next) picked.push(next);
            if (picked.length >= max) break;
        }
    }
    return picked.map((d, i) => ({
        id: `E${i + 1}`,
        kind: d.kind,
        label: clip(d.label, 140),
        text: clip(d.text, maxChars),
        ref: d.ref,
        href: d.href,
    }));
}
