import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getRag, type CompanySearchOptions } from "@launchstack/search";
import { invokeMarketingStructured } from "./models";
import type { TargetPersona } from "./types";
import { TargetPersonaSchema } from "./types";

export async function extractTargetPersona(args: {
    companyId: number;
    targetAudience: string;
}): Promise<TargetPersona> {
    const { companyId, targetAudience } = args;

    const options: CompanySearchOptions = { companyId, topK: 6, weights: [0.4, 0.6] };
    const results = await getRag().companyEnsembleSearch(
        `target audience customer persona ${targetAudience} pain points needs priorities`,
        options
    );

    const snippets = results
        .slice(0, 6)
        .map(r => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 400))
        .filter(Boolean);

    const contextBlock =
        snippets.length > 0
            ? snippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n")
            : "No persona-relevant data found in KB.";

    const response = await invokeMarketingStructured(
        TargetPersonaSchema,
        [
            new SystemMessage(
                `You are an audience research analyst. Given a target audience description and company knowledge, synthesize a TargetPersona profile.

Rules:
- role: their job title or function (e.g., "VP of Engineering at mid-stage SaaS").
- painPoints: 3-5 specific frustrations they face that the company can address.
- priorities: 3-5 things they care most about when evaluating solutions.
- languageStyle: how they prefer to be spoken to (e.g., "direct and data-driven, no fluff").

Ground everything in the provided context. Return valid JSON.`
            ),
            new HumanMessage(
                `Target audience: ${targetAudience}\n\nCompany knowledge:\n\n${contextBlock}`
            ),
        ],
        "target_persona"
    );

    return TargetPersonaSchema.parse(response);
}
