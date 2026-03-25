import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
} from "~/lib/tools/rag";
import type { TargetPersona } from "~/lib/tools/marketing-pipeline/types";
import { TargetPersonaSchema } from "~/lib/tools/marketing-pipeline/types";

const PERSONA_SYSTEM_PROMPT = `You are an ICP analyst. Given a target audience description and company knowledge snippets, produce a TargetPersona profile.

Rules:
- role: the job title or role description of the target reader.
- painPoints: 2–4 specific challenges this persona faces, grounded in the company's domain.
- priorities: 2–4 things this persona cares most about when evaluating solutions.
- languageStyle: 1 sentence on how to write for this person (technical depth, formality, jargon tolerance).

Use the company knowledge to make pain points and priorities specific rather than generic. Return valid JSON matching the schema.`;

export async function extractTargetPersona(args: {
    companyId: number;
    targetAudience: string;
}): Promise<TargetPersona> {
    const { companyId, targetAudience } = args;

    const embeddings = createOpenAIEmbeddings();
    const options: CompanySearchOptions = {
        companyId,
        topK: 4,
        weights: [0.4, 0.6],
    };

    let snippets: string[] = [];
    try {
        const results = await companyEnsembleSearch(
            `${targetAudience} customer persona use case pain point`,
            options,
            embeddings,
        );
        snippets = results
            .slice(0, 4)
            .map((r) => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 400))
            .filter(Boolean);
    } catch (error) {
        console.warn("[marketing-pipeline] persona RAG failed:", error);
    }

    const contextParts = [
        `Target audience: ${targetAudience}`,
        "",
        snippets.length > 0
            ? `Company knowledge:\n${snippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`
            : "No company knowledge snippets available.",
    ];

    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const model = chat.withStructuredOutput(TargetPersonaSchema, { name: "target_persona" });
    const response = await model.invoke([
        new SystemMessage(PERSONA_SYSTEM_PROMPT),
        new HumanMessage(contextParts.join("\n")),
    ]);

    return TargetPersonaSchema.parse(response);
}
