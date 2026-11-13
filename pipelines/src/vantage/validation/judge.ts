import { HumanMessage } from "@langchain/core/messages";
import {
    invokeStructuredAttempt,
    systemMessageFor,
    type ResolvedChatModel,
} from "@launchstack/llm";
import {
    RUBRIC_VERSION,
    SCOPED_EVALUATION_VERSION,
    SCOPED_RUBRIC_VERSION,
    EVALUATION_VERSION,
    type Judgment,
    type ValidationJudge,
} from "./contracts";
import {
    fingerprint,
    judgeInputPayload,
    parseEvaluationInput,
    MAX_EVALUATION_INPUT_BYTES,
} from "./input";
import { VALIDATION_SYSTEM_PROMPT, SCOPED_VALIDATION_SYSTEM_PROMPT } from "./rubric";
import {
    judgmentSchemaFor,
    JUDGE_EVIDENCE_INSTRUCTIONS,
    JUDGE_EVIDENCE_TRANSPORT_VERSION,
} from "./judge-evidence";

/** No model is selected implicitly; use the host's reviewed model configuration. One call, no retries. */
export function createModelValidationJudge(
    model: ResolvedChatModel,
    options: {
        configurationId: string;
        timeoutMs?: number;
        maxOutputTokens?: number;
        evaluationVersion?: typeof EVALUATION_VERSION | typeof SCOPED_EVALUATION_VERSION;
    },
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
    const evaluationVersion = options.evaluationVersion ?? EVALUATION_VERSION;
    const rubricVersion =
        evaluationVersion === SCOPED_EVALUATION_VERSION ? SCOPED_RUBRIC_VERSION : RUBRIC_VERSION;
    return {
        kind: "model",
        id: `${model.modelId}/${options.configurationId}/${rubricVersion}/${JUDGE_EVIDENCE_TRANSPORT_VERSION}`,
        async evaluate(request, signal) {
            if (
                request.input.version !== evaluationVersion ||
                request.rubricVersion !== rubricVersion
            )
                throw new Error(
                    "Judge configuration does not match the evaluation/rubric version."
                );
            const payload = judgeInputPayload(request.input);
            if (evaluationVersion === SCOPED_EVALUATION_VERSION) {
                parseEvaluationInput(request.input);
                if (Buffer.byteLength(payload) > MAX_EVALUATION_INPUT_BYTES)
                    throw new Error("Scoped Judge input exceeds 14000 bytes.");
            }
            const result = await invoke(
                model,
                judgmentSchemaFor(request),
                [
                    ...systemMessageFor(
                        model.behavior,
                        `${evaluationVersion === SCOPED_EVALUATION_VERSION ? SCOPED_VALIDATION_SYSTEM_PROMPT : VALIDATION_SYSTEM_PROMPT}\n${JUDGE_EVIDENCE_INSTRUCTIONS}`
                    ),
                    new HumanMessage(payload),
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
        rubricVersion: typeof RUBRIC_VERSION | typeof SCOPED_RUBRIC_VERSION;
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
