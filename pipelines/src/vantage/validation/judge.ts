import { HumanMessage } from "@langchain/core/messages";
import {
    invokeStructuredAttempt,
    systemMessageFor,
    type ResolvedChatModel,
} from "@launchstack/llm";
import { JudgmentSchema, RUBRIC_VERSION, type Judgment, type ValidationJudge } from "./contracts";
import { fingerprint } from "./input";
import { VALIDATION_SYSTEM_PROMPT } from "./rubric";

/** No model is selected implicitly; use the host's reviewed model configuration. One call, no retries. */
export function createModelValidationJudge(
    model: ResolvedChatModel,
    options: { configurationId: string; timeoutMs?: number; maxOutputTokens?: number },
    invoke: typeof invokeStructuredAttempt = invokeStructuredAttempt
): ValidationJudge {
    const timeoutMs = options.timeoutMs ?? 20000;
    const maxOutputTokens = options.maxOutputTokens ?? 4096;
    if (
        !options.configurationId ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60000 ||
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 256 ||
        maxOutputTokens > 6000
    )
        throw new Error("Invalid validation judge limits or configuration identity.");
    return {
        kind: "model",
        id: `${model.modelId}/${options.configurationId}/${RUBRIC_VERSION}`,
        async evaluate(request, signal) {
            const result = await invoke(
                model,
                JudgmentSchema,
                [
                    ...systemMessageFor(model.behavior, VALIDATION_SYSTEM_PROMPT),
                    new HumanMessage(
                        JSON.stringify({
                            scenario: request.input.scenario,
                            candidate: {
                                id: request.input.actual.id,
                                pipelineVersion: request.input.actual.pipelineVersion,
                            },
                            outputUnits: request.outputUnits,
                        })
                    ),
                ],
                { signal, timeoutMs, maxOutputTokens }
            );
            return { judgment: result.result, usage: result.usage };
        },
    };
}

/** Demo/calibration replay is bound to exact input and rubric; it never evaluates a changed candidate. */
export function createRecordedValidationJudge(
    records: readonly {
        inputFingerprint: string;
        rubricVersion: typeof RUBRIC_VERSION;
        judgment: Judgment;
    }[],
    id = "synthetic-calibration-v1"
): ValidationJudge {
    const frozen = structuredClone(records);
    if (new Set(frozen.map(record => record.inputFingerprint)).size !== frozen.length)
        throw new Error("Duplicate recorded evaluation input.");
    return {
        kind: "fixture-replay",
        id,
        async evaluate(request) {
            const record = frozen.find(
                item =>
                    item.inputFingerprint === fingerprint(request.input) &&
                    item.rubricVersion === request.rubricVersion
            );
            if (!record)
                throw new Error("No exact recorded judgment exists for this input and rubric.");
            return { judgment: structuredClone(record.judgment) };
        },
    };
}
