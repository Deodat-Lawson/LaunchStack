import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  invokeStructured,
  resolveChatModel,
  type ChatRoute,
} from "@launchstack/core/llm";

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
 * Judge route. A route names the job, not the model — which model serves
 * `reasoning` is the operator's call, recorded per run below so a score can
 * still be traced to what produced it.
 */
export const JUDGE_ROUTE: ChatRoute = "reasoning";

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
  // Single sample for now (N-sample median is a later stability upgrade —
  // see TODO-l.md Phase 1).
  const resolved = resolveChatModel({ route: JUDGE_ROUTE });

  const raw = await invokeStructured(
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

  const result = JudgeResultSchema.parse(raw);
  return {
    ...result,
    platform: input.platform,
    // The concrete model the route resolved to, so a stored score stays
    // interpretable after the operator repoints the route.
    judgeModel: resolved.modelId,
    rubricVersion: JUDGE_RUBRIC_VERSION,
  };
}
