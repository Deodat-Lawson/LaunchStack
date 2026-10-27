/**
 * Is a company someone who would buy what the segment sells? By meaning, not
 * by shared words.
 *
 * The brief ("cafés and retailers that would buy and resell specialty coffee
 * beans …") and each company's own words (name, directory categories,
 * description, later its dossier) are embedded. A company's relevance is how
 * much closer it sits to the brief than to a plain "a business": the embedding
 * model's baseline similarity between any two business descriptions cancels
 * out, so the same rule holds on any embedding model without a tuned cutoff.
 * Above zero, the company reads more like the buyer than like business in
 * general; at one, it reads like the brief itself.
 *
 * Where a chat model is configured, the closest companies are then checked
 * with it ("would this business plausibly buy this?"); a no, with its reason,
 * takes a company off the shortlist.
 *
 * With no embedding model, relevance falls back to word overlap (./score's
 * categoryCoverage) and the run says so.
 */
import type { PartnerKind, ProgramRecord } from "./types";
import { categoryCoverage, textTerms } from "./score";

export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

export interface FitVerdict {
    fit: boolean;
    reason: string;
}

/** A chat-model check of candidates against the brief; ids it leaves out are not judged. */
export type JudgeFit = (args: {
    brief: string;
    candidates: Array<{ id: string; name: string; text: string }>;
}) => Promise<Map<string, FitVerdict>>;

/** What every company is compared against so the model's baseline cancels out. */
export const BASELINE_TEXT = "A business.";

const KIND_WORDS: Record<PartnerKind, string> = {
    importer: "importers",
    distributor: "distributors",
    wholesaler: "wholesalers",
    retailer: "retailers and shops",
    agent: "sales agents",
    reseller: "resellers",
    supplier: "suppliers",
};

/** Who the segment wants, in one paragraph: the text companies are matched against. */
export function buyerBrief(
    program: Pick<ProgramRecord, "offering" | "categories" | "constraints">,
    partnerKinds: readonly PartnerKind[]
): string {
    const kinds = partnerKinds.map(k => KIND_WORDS[k] ?? k).join(", ") || "businesses";
    return [
        `${kinds[0]!.toUpperCase()}${kinds.slice(1)} that would buy, stock or resell this: ${program.offering.trim()}`,
        program.categories.length > 0 ? `Categories: ${program.categories.join(", ")}.` : "",
        program.constraints ? `Constraints: ${program.constraints}` : "",
    ]
        .filter(Boolean)
        .join(" ");
}

/** A company's own words, the way it is matched. */
export function companyText(org: {
    name: string;
    categories?: readonly string[];
    description?: string | null;
    extra?: readonly string[];
}): string {
    return [
        org.name,
        org.categories?.length ? `(${org.categories.join(", ")})` : "",
        org.description ?? "",
        ...(org.extra ?? []),
    ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 2_000);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        na += a[i]! * a[i]!;
        nb += b[i]! * b[i]!;
    }
    return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const BATCH = 64;

/**
 * Relevance of each text to the brief, in (-∞, 1]: (sim(text, brief) −
 * sim(text, baseline)) / (1 − sim(brief, baseline)). Above zero is relevant.
 */
export async function semanticRelevance(
    embed: EmbedTexts,
    brief: string,
    texts: readonly string[]
): Promise<number[]> {
    const [briefVector, baselineVector] = await embed([brief, BASELINE_TEXT]);
    if (!briefVector || !baselineVector) throw new Error("The embedder returned no vectors");
    const span = 1 - cosine(briefVector, baselineVector);
    const out: number[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
        const vectors = await embed(texts.slice(i, i + BATCH));
        for (const v of vectors) {
            const toBrief = cosine(v, briefVector);
            const toBaseline = cosine(v, baselineVector);
            out.push(span > 0 ? (toBrief - toBaseline) / span : toBrief - toBaseline);
        }
    }
    return out;
}

/** Word-overlap relevance in [0, 1]: the fallback when no embedder is configured. */
export function lexicalRelevance(
    program: Pick<ProgramRecord, "categories" | "offering">,
    texts: readonly string[]
): number {
    return categoryCoverage(program, textTerms(texts));
}

export interface Relevance {
    /** By meaning (embeddings) or by shared words (no embedder configured). */
    method: "semantic" | "lexical";
    scores: number[];
}

/**
 * Relevance of each company to the segment. Semantic when an embedder is
 * given and answers; otherwise lexical, so a run never stops on it.
 */
export async function relevanceOf(
    embed: EmbedTexts | null | undefined,
    program: Pick<ProgramRecord, "offering" | "categories" | "constraints">,
    partnerKinds: readonly PartnerKind[],
    companies: ReadonlyArray<Parameters<typeof companyText>[0]>
): Promise<Relevance> {
    if (embed && companies.length > 0) {
        try {
            const scores = await semanticRelevance(
                embed,
                buyerBrief(program, partnerKinds),
                companies.map(companyText)
            );
            return { method: "semantic", scores };
        } catch (error) {
            console.warn("[distribution] embeddings failed; matching by words instead:", error);
        }
    }
    return {
        method: "lexical",
        scores: companies.map(c =>
            lexicalRelevance(program, [c.name, ...(c.categories ?? []), c.description ?? ""])
        ),
    };
}

/** Relevance as a share in [0, 1] for the fit rubric (a real buyer lands near 0.4). */
export function relevanceShare(relevance: number, method: Relevance["method"]): number {
    if (method === "lexical") return Math.max(0, Math.min(1, relevance * 1.5));
    return Math.max(0, Math.min(1, relevance / 0.4));
}
