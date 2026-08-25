import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { JudgeResultSchema, JUDGE_RUBRIC_VERSION, JUDGE_SYSTEM_PROMPT, buildJudgeHumanPrompt, } from "./rubric.js";
export async function scorePost(input) {
    // temperature 0 for repeatability; single sample for now (N-sample median is
    // a possible later stability upgrade).
    const resolved = resolveChatModel({ temperature: 0 });
    const result = await invokeStructured(resolved, JudgeResultSchema, [
        new SystemMessage(JUDGE_SYSTEM_PROMPT),
        new HumanMessage(buildJudgeHumanPrompt({
            platform: input.platform,
            referenceMarkdown: input.referenceMarkdown,
            companyContext: input.companyContext,
            post: input.post,
        })),
    ], { name: "post_evaluation" });
    return {
        ...result,
        platform: input.platform,
        judgeModel: resolved.modelId,
        rubricVersion: JUDGE_RUBRIC_VERSION,
    };
}
//# sourceMappingURL=judge.js.map