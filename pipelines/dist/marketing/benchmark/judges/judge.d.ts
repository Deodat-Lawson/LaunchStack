import { type JudgeResult } from "./rubric.js";
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
export declare function scorePost(input: JudgePostInput): Promise<ScoredPost>;
//# sourceMappingURL=judge.d.ts.map
