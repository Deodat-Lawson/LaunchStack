import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/core/llm";

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

/**
 * The judge resolves through the deployment's `default` chat route; the wire
 * model id is recorded on every result for reproducibility.
 */

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
  // a possible later stability upgrade).
  const resolved = resolveChatModel({ temperature: 0 });
  const result = await invokeStructured(
    resolved,
    JudgeResultSchema,
    [
      new SystemMessage(JUDGE_SYSTEM_PROMPT),
      new HumanMessage(
        buildJudgeHumanPrompt({
          platform: input.platform,
          referenceMarkdown: input.referenceMarkdown,
          companyContext: input.companyContext,
          post: input.post,
        }),
      ),
    ],
    { name: "post_evaluation" },
  );

  return {
    ...result,
    platform: input.platform,
    judgeModel: resolved.modelId,
    rubricVersion: JUDGE_RUBRIC_VERSION,
  };
}
