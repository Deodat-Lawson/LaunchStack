/**
 * A deterministic stand-in for an embedding model, for tests: each word
 * (lowercased, crude singular) is hashed into one of 512 dimensions. Texts
 * that share words point the same way; it has no notion of synonyms, which
 * is what a real model adds — tests here check the plumbing and the rules
 * built on similarity, not the model's judgement.
 */
import type { EmbedTexts } from "./semantic";

const DIMENSIONS = 512;
const STOP = new Set(["a", "an", "and", "the", "of", "for", "in", "to", "that", "this", "would"]);

function hash(word: string): number {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
        h ^= word.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % DIMENSIONS;
}

export function fakeVector(text: string): number[] {
    const v = new Array<number>(DIMENSIONS).fill(0);
    for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (raw.length < 2 || STOP.has(raw)) continue;
        const word = raw.replace(/(ies|es|s)$/, "");
        v[hash(word)]! += 1;
    }
    // Every text shares a little of one direction, the way real embeddings
    // of any two business descriptions are never orthogonal.
    v[0]! += 1;
    return v;
}

export const fakeEmbed: EmbedTexts = async texts => texts.map(fakeVector);
