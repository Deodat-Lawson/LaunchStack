/**
 * The chat-model check of a shortlist: given who the segment sells to and
 * what each company says about itself, would it plausibly buy this? One call
 * per batch, structured output, and a short reason for every no so the run
 * can say why a company was left out.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { z } from "zod";

import type { FitVerdict, JudgeFit } from "./semantic";

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
For each company decide: would this kind of business plausibly buy, stock or resell what the seller offers?
Judge the type of business, not its size or whether it is famous. Software, agencies and other businesses that would not buy the product are not a fit.
Answer for every id. Keep each reason to one short sentence.`;

const BATCH = 20;

export function buildJudgePrompt(
    brief: string,
    candidates: Array<{ id: string; name: string; text: string }>
): string {
    return [
        `Who the seller wants: ${brief}`,
        "",
        "Companies:",
        ...candidates.map(c => `- id ${c.id}: ${c.text.slice(0, 600)}`),
    ].join("\n");
}

/** The default judge: the workspace's fast chat route. */
export function createFitJudge(): JudgeFit {
    return async ({ brief, candidates }) => {
        const model = resolveChatModel({ route: "fast", temperature: 0 });
        const out = new Map<string, FitVerdict>();
        for (let i = 0; i < candidates.length; i += BATCH) {
            const batch = candidates.slice(i, i + BATCH);
            const result = await invokeStructured(
                model,
                VerdictsSchema,
                [new SystemMessage(SYSTEM), new HumanMessage(buildJudgePrompt(brief, batch))],
                { name: "prospect_fit" }
            );
            const ids = new Set(batch.map(c => c.id));
            for (const v of result.verdicts)
                if (ids.has(v.id)) out.set(v.id, { fit: v.fit, reason: v.reason });
        }
        return out;
    };
}
