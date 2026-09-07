/**
 * Stage D — one gated explanation run over a workspace checkout
 * (design §3.4): warm-start from the context bundle, explore through the
 * four read-only tools (or skip straight to the packed digest when the repo
 * fits), validate through the deterministic gate, repair at most once, and
 * return the draft with full provenance either way. The *caller* decides
 * what a failed gate means (the job fails visibly — never a silently
 * degraded answer).
 */
import { z } from "zod";
import { runAgent } from "@launchstack/llm";
import { renderRepoStats } from "@launchstack/pipelines/repo-workspace";
import { validateExplanation } from "./gate.js";
import { packDigest } from "./pack.js";
import { loadExplainerSkills } from "./skills.js";
import { makeExplainerTools } from "./workspace-tools.js";
export const EXPLAINER_PROMPT_VERSION = "repo-explainer-agent/v1";
const DraftSchema = z.object({
    summary: z.string().describe("Markdown summary: ## Overview, ## Structure, ## Key components"),
    mermaidCode: z.string().describe("One Mermaid diagram following the diagram rules"),
});
export const DEFAULT_EXPLAIN_LIMITS = {
    maxTurns: 12,
    tokenBudget: 250_000,
    fastPathMaxChars: 300_000,
};
function memoryFilesBlock(bundle) {
    if (bundle.memoryFiles.length === 0)
        return "(none found)";
    return bundle.memoryFiles
        .map(file => `===== ${file.path}${file.truncated ? " (truncated)" : ""} =====\n${file.content}`)
        .join("\n\n");
}
function taskPrompt(repoName, diagramType, instructions) {
    const trimmed = instructions?.trim();
    const instructionsSection = trimmed
        ? `USER REQUEST (tailor the summary and diagram to answer this; do not add a separate section for it):\n"${trimmed}"\n\n`
        : "";
    return (`${instructionsSection}Explain the repository ${repoName}. ` +
        `Produce the summary and one ${diagramType} diagram, then call submit_result.`);
}
export async function runRepoExplanation(input) {
    const limits = { ...DEFAULT_EXPLAIN_LIMITS, ...input.limits };
    const skills = loadExplainerSkills(input.diagramType);
    const files = await input.view.listFiles();
    const repoFiles = new Set(files.map(file => file.path));
    const systemBase = [skills.system, "", "# Diagram rules for this run", "", skills.rubric].join("\n");
    const pack = await packDigest(input.view, input.bundle, limits.fastPathMaxChars);
    let draft;
    let readPaths;
    let turns;
    let usage;
    let modelId;
    let path;
    if (!pack.truncated) {
        // Fast path: the whole repository fits — no exploration needed.
        path = "fast";
        readPaths = new Set(pack.includedPaths);
        const run = await runAgent(input.port, {
            system: `${systemBase}\n\n# Mode\n\nThe COMPLETE repository content is in the ` +
                "message below. Do not ask for more files — read what is given and " +
                "call submit_result.",
            user: `${taskPrompt(input.repoName, input.diagramType, input.instructions)}\n\n${pack.digest}`,
            tools: [],
            finalSchema: DraftSchema,
            maxTurns: 3,
            tokenBudget: limits.tokenBudget,
            signal: input.signal,
            onTurn: info => input.onTurn?.({ turn: info.turn, toolCalls: info.toolCalls }),
        });
        draft = run.output;
        turns = run.turns;
        usage = run.usage;
        modelId = run.modelId;
    }
    else {
        path = "loop";
        const toolset = makeExplainerTools(input.view, input.bundle);
        const warmStart = [
            "# Repository overview (precomputed)",
            "",
            "## Stats",
            renderRepoStats(input.bundle.stats),
            "",
            "## Ranked repo map (most-depended-on files first)",
            input.bundle.map.rendered || "(no code files mapped)",
            "",
            "## Directory tree",
            input.bundle.tree,
            "",
            "## The repository's own documentation",
            memoryFilesBlock(input.bundle),
        ].join("\n");
        const run = await runAgent(input.port, {
            system: `${systemBase}\n\n${warmStart}`,
            user: taskPrompt(input.repoName, input.diagramType, input.instructions),
            tools: toolset.tools,
            finalSchema: DraftSchema,
            maxTurns: limits.maxTurns,
            tokenBudget: limits.tokenBudget,
            signal: input.signal,
            onTurn: info => input.onTurn?.({ turn: info.turn, toolCalls: info.toolCalls }),
        });
        draft = run.output;
        turns = run.turns;
        usage = run.usage;
        modelId = run.modelId;
        readPaths = toolset.getReadPaths();
    }
    const gateContext = { requestedType: input.diagramType, repoFiles, readPaths };
    let gate = validateExplanation(draft, gateContext);
    let repaired = false;
    if (!gate.ok) {
        // One bounded repair with the gate's structured errors — the
        // founder-weekly-review pattern. A second failure stays failed.
        repaired = true;
        const gateReport = gate.errors
            .map(error => `- [${error.code}] ${error.message}${error.detail ? ` (${error.detail})` : ""}`)
            .join("\n");
        const repairRun = await runAgent(input.port, {
            system: systemBase,
            user: `Your previous result failed validation. Fix every issue and call ` +
                `submit_result with the corrected result.\n\nValidation errors:\n${gateReport}\n\n` +
                `Only reference file paths from this list of files you have read:\n` +
                `${[...readPaths].sort().join("\n") || "(none)"}\n\n` +
                `Previous summary:\n${draft.summary}\n\nPrevious diagram:\n${draft.mermaidCode}`,
            tools: [],
            finalSchema: DraftSchema,
            maxTurns: 2,
            tokenBudget: limits.tokenBudget,
            signal: input.signal,
            onTurn: info => input.onTurn?.({ turn: info.turn, toolCalls: info.toolCalls }),
        });
        usage = {
            inputTokens: sum(usage.inputTokens, repairRun.usage.inputTokens),
            outputTokens: sum(usage.outputTokens, repairRun.usage.outputTokens),
            totalTokens: sum(usage.totalTokens, repairRun.usage.totalTokens),
            reasoningTokens: sum(usage.reasoningTokens, repairRun.usage.reasoningTokens),
        };
        turns += repairRun.turns;
        modelId = repairRun.modelId ?? modelId;
        draft = repairRun.output;
        gate = validateExplanation(draft, gateContext);
    }
    return {
        summary: draft.summary,
        mermaidCode: draft.mermaidCode,
        filesRead: [...readPaths].sort(),
        path,
        turns,
        usage,
        modelId,
        gate,
        repaired,
        skillVersion: skills.version,
        skillHash: skills.hash,
        promptVersion: EXPLAINER_PROMPT_VERSION,
    };
}
function sum(a, b) {
    return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}
//# sourceMappingURL=explain.js.map