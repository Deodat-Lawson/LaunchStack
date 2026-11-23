/**
 * The chat-model check of a shortlist: given who the segment sells to and
 * what each company says about itself, would it plausibly buy this? One call
 * per batch, structured output, and a short reason for every no so the run
 * can say why a company was left out.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { z } from "zod";

import type { FitVerdict, JudgeFit, SellerContext } from "./semantic";

const VerdictsSchema = z.object({
    verdicts: z.array(
        z.object({
            id: z.string(),
            fit: z.boolean(),
            reason: z.string().max(300),
        })
    ),
});

const SYSTEM = `You qualify sales prospects. You are given who a seller wants to sell to and a list of companies, each with only what its own listing or website says.
For each company decide: would this kind of business plausibly buy, stock or resell what the seller offers? Go by what the seller's profile and documents say about its products and customers.
Judge the type of business, not its size or whether it is famous. Software, agencies and other businesses that would not buy the product are not a fit. Articles, lists, directories and publishers are not companies that would buy it, so they are not a fit either.
Also judge where it is. A company whose text places it somewhere other than where the seller wants, and not right next to it, is not a fit. Naming other countries as sources or markets does not place it there ("beans from Ethiopia"). When the text does not say where a company is, judge only the type of business.
A business that has closed or stopped trading, or whose website is for sale or parked, is not a fit, however well it once matched.
Answer for every id. Keep each reason to one short sentence.`;

const MATCH_SYSTEM = `You qualify companies for a list someone asked for. You are given their description of the companies they want and a list of companies, each with what its own listing, website or research says.
For each company decide: does it match the description? Check every requirement the description states: industry or kind of business, size, revenue, valuation or market value, funding, headcount, ownership, and anything else it names.
Use what you reliably know about well-known companies (a public company's market value, a famous company's size) as well as the text given. When a requirement cannot be checked from the text or what you know, and the company plausibly meets it, count it as a match and say what was not confirmed.
Location is never assumed: a company is in the place only when its text or what you reliably know puts its headquarters or a real office there. "Plausibly has an office there" is not a match.
Also judge where it is. A company in the same metropolitan area as the place asked for is there (Santa Monica, Irvine and Pasadena are in greater Los Angeles), unless the description says "only in" a place. A company headquartered elsewhere that has a real office in the place counts too. Naming other places as markets does not place it there.
Articles, lists, directories and publishers are not companies, so they do not match. A business that has closed, or whose website is for sale or parked, does not match.
Answer for every id. Keep each reason to one short sentence that names the facts you used ("Snap: Santa Monica tech company, market value about $15B").`;

const BATCH = 20;
const SELLER_KNOWLEDGE = 1_500;
const CANDIDATE_TEXT = 2_000;

export function buildJudgePrompt(
    brief: string,
    where: string,
    candidates: Array<{ id: string; name: string; text: string }>,
    seller?: SellerContext | null
): string {
    const knowledge = seller?.knowledgeContext?.trim().slice(0, SELLER_KNOWLEDGE);
    return [
        `Who the seller wants: ${brief}`,
        `Where the seller wants them: ${where}`,
        ...(knowledge ? [`What the seller's own documents say:\n${knowledge}`] : []),
        "",
        "Companies:",
        ...candidates.map(c => `- id ${c.id}: ${c.text.slice(0, CANDIDATE_TEXT)}`),
    ].join("\n");
}

/** The `match` question: the description and place, no seller (it is not selling to them). */
export function buildMatchPrompt(
    brief: string,
    where: string,
    candidates: Array<{ id: string; name: string; text: string }>
): string {
    return [
        `What they want: ${brief}`,
        `Where: ${where}`,
        "",
        "Companies:",
        ...candidates.map(c => `- id ${c.id}: ${c.text.slice(0, CANDIDATE_TEXT)}`),
    ].join("\n");
}

/** The default judge: the workspace's fast chat route. */
export function createFitJudge(): JudgeFit {
    return async ({ brief, where, candidates, seller, question = "buyer" }) => {
        const model = resolveChatModel({ route: "fast", temperature: 0 });
        const out = new Map<string, FitVerdict>();
        for (let i = 0; i < candidates.length; i += BATCH) {
            const batch = candidates.slice(i, i + BATCH);
            const result = await invokeStructured(
                model,
                VerdictsSchema,
                [
                    new SystemMessage(question === "match" ? MATCH_SYSTEM : SYSTEM),
                    new HumanMessage(
                        question === "match"
                            ? buildMatchPrompt(brief, where, batch)
                            : buildJudgePrompt(brief, where, batch, seller)
                    ),
                ],
                { name: "prospect_fit" }
            );
            const ids = new Set(batch.map(c => c.id));
            for (const v of result.verdicts)
                if (ids.has(v.id)) out.set(v.id, { fit: v.fit, reason: v.reason });
        }
        return out;
    };
}
