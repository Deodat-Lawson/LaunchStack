import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
} from "~/lib/tools/rag";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type { TargetPersona } from "~/lib/tools/marketing-pipeline/types";
import { TargetPersonaSchema } from "~/lib/tools/marketing-pipeline/types";

export async function extractTargetPersona(args: {
    companyId: number;
    targetAudience: string;
}): Promise<TargetPersona> {
    const { companyId, targetAudience } = args;

    const embeddings = createOpenAIEmbeddings();
    const options: CompanySearchOptions = { companyId, topK: 6, weights: [0.4, 0.6] };
    const results = await companyEnsembleSearch(
        `target audience customer persona ${targetAudience} pain points needs priorities`,
        options,
        embeddings,
    );

    const snippets = results
        .slice(0, 6)
        .map((r) => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 400))
        .filter(Boolean);

    const contextBlock = snippets.length > 0
        ? snippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n")
        : "No persona-relevant data found in KB.";

    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const model = chat.withStructuredOutput(TargetPersonaSchema, { name: "target_persona" });

    const response = await model.invoke([
        new SystemMessage(
            `You are an audience research analyst. Given a target audience description and company knowledge, synthesize a TargetPersona profile.

Rules:
- role: their job title or function (e.g., "VP of Engineering at mid-stage SaaS").
- painPoints: 3-5 specific frustrations they face that the company can address.
- priorities: 3-5 things they care most about when evaluating solutions.
- languageStyle: how they prefer to be spoken to (e.g., "direct and data-driven, no fluff").

Ground everything in the provided context. Return valid JSON.`,
        ),
        new HumanMessage(
            `Target audience: ${targetAudience}\n\nCompany knowledge:\n\n${contextBlock}`,
        ),
    ]);

    return TargetPersonaSchema.parse(response);
}
