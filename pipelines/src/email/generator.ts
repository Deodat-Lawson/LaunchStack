import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { buildCompanyKnowledgeContext, extractCompanyDNA } from "../marketing/context";
import { invokeEmailStructured } from "./models";
import { EmailTemplateSchema, type EmailTemplate } from "./types";

/**
 * Generate a company-grounded outreach email TEMPLATE (with {{merge tokens}})
 * from the account owner's company data. Reuses the marketing-pipeline company
 * context so claims are grounded in the same facts.
 */

const SYSTEM_PROMPT = [
    "You write short B2B cold-outreach email templates on behalf of a company.",
    "Rules:",
    "- Ground EVERY claim about the sender's company in the provided company context. Never invent facts, metrics, customers, or awards.",
    "- Use merge tokens for anything recipient-specific: {{firstName}}, {{recipientCompany}}.",
    "- ALWAYS include {{unsubscribeUrl}} and {{senderIdentity}} in the body (compliance).",
    "- One clear, low-friction call to action. Honest subject line — no clickbait, no fake RE:/FW:.",
    "- Keep it concise and human; no corporate filler or hype.",
    "Return { subject, body, variables } where `variables` lists every {{token}} used.",
].join("\n");

export async function generateTemplate(args: {
    companyId: number;
    goal?: string;
}): Promise<{ template: EmailTemplate; companyContext: string; modelId: string }> {
    // A blank goal falls back too, not just a missing one — `??` would send an
    // empty string straight into the prompt.
    const trimmedGoal = args.goal?.trim() ?? "";
    const goal =
        trimmedGoal.length > 0
            ? trimmedGoal
            : "Introduce our company to a relevant prospect and offer to help.";

    const [context, dna] = await Promise.all([
        buildCompanyKnowledgeContext({ companyId: args.companyId, prompt: goal }),
        extractCompanyDNA({ companyId: args.companyId, prompt: goal })
            .then(r => r.dna)
            .catch(() => null),
    ]);

    const companyContext = dna
        ? `${context}\n\n=== Company DNA ===\n${JSON.stringify(dna, null, 2)}`
        : context;

    const { result: template, modelId } = await invokeEmailStructured(
        "templateGeneration",
        EmailTemplateSchema,
        [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(
                `Campaign goal: ${goal}\n\nSender company context (single source of truth):\n${companyContext}`
            ),
        ],
        "email_template"
    );

    return { template, companyContext, modelId };
}
