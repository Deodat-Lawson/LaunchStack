import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModelByType } from "@launchstack/core/llm";

import { EMAIL_MODELS } from "./models";
import {
  TemplateReviewSchema,
  type EmailTemplate,
  type TemplateReview,
} from "./types";

/**
 * Review the generated template with a second LLM call. SCORES ONLY — it never
 * rewrites; a human decides whether to send. `pass` requires strong grounding
 * and compliance with nothing fabricated.
 */

const SYSTEM_PROMPT = [
  "You are a strict reviewer of cold-outreach email templates. Score 0-100 on each criterion:",
  "- grounding: every claim is supported by the company context (fabrication scores 0).",
  "- clarity: clear, concise, one obvious ask.",
  "- tone: human and appropriate, not hypey or robotic.",
  "- spam_risk: HIGHER = less spammy (no scammy phrasing, no fake urgency).",
  "- cta_strength: a clear, low-friction call to action.",
  "- compliance: includes {{unsubscribeUrl}} and a sender identity, and the subject is honest.",
  "Do NOT rewrite the email. Return scores, issues, a one-line summary, and a verdict.",
  'verdict = "pass" ONLY if grounding and compliance are strong and nothing is invented; otherwise "revise".',
].join("\n");

export async function reviewTemplate(args: {
  template: EmailTemplate;
  companyContext: string;
}): Promise<TemplateReview> {
  const chat = getChatModelByType(EMAIL_MODELS.templateReview, {
    temperature: 0,
  });
  const model = chat.withStructuredOutput(TemplateReviewSchema, {
    name: "template_review",
  });

  const raw = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Company context (the facts the email may use):\n${args.companyContext}\n\n` +
        `Template to review:\nSubject: ${args.template.subject}\n\n${args.template.body}`,
    ),
  ]);

  return TemplateReviewSchema.parse(raw);
}
