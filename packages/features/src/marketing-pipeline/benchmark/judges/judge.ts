import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModelByType } from "@launchstack/core/llm";
import type { AIModelType } from "@launchstack/core/llm";

import {
  JudgeResultSchema,
  JUDGE_RUBRIC_VERSION,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeHumanPrompt,
  type JudgeResult,
} from "./rubric";

/**
 * LLM-as-judge for a single marketing post. Produces raw 0–100 scores per
 * criterion — no rewrite, no mutation of the post. Configure the model with
 * `configureChatModels` (see ../setup.ts) before calling.
 */

/** Judge model, version-pinned for reproducibility. */
export const JUDGE_MODEL: AIModelType = "gpt-4o";

export type ReferencePlatform = "x" | "linkedin" | "reddit";

export interface JudgePostInput {
  platform: ReferencePlatform;
  /** Company-context window the post was generated from (mirror of generation). */
  companyContext: string;
  /** The candidate post to score. */
  post: string;
  /** Contents of the platform reference md (references/<platform>.md). */
  referenceMarkdown: string;
}

export interface ScoredPost extends JudgeResult {
  platform: ReferencePlatform;
  judgeModel: string;
  rubricVersion: string;
}

export async function scorePost(input: JudgePostInput): Promise<ScoredPost> {
  // temperature 0 for repeatability; single sample for now (N-sample median is
  // a later stability upgrade — see TODO-l.md Phase 1).
  const chat = getChatModelByType(JUDGE_MODEL, { temperature: 0 });
  const model = chat.withStructuredOutput(JudgeResultSchema, {
    name: "post_evaluation",
  });

  const raw = await model.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(
      buildJudgeHumanPrompt({
        platform: input.platform,
        referenceMarkdown: input.referenceMarkdown,
        companyContext: input.companyContext,
        post: input.post,
      }),
    ),
  ]);

  const result = JudgeResultSchema.parse(raw);
  return {
    ...result,
    platform: input.platform,
    judgeModel: JUDGE_MODEL,
    rubricVersion: JUDGE_RUBRIC_VERSION,
  };
}
