import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { normalizeModelContent, resolveChatModel } from "@launchstack/llm";
import { FILES_TO_EXPLORE_SYSTEM, SYSTEM_PROMPT, getFilesToExploreSystem, getSystemPrompt, buildFilesToExploreUserPrompt, buildUserPrompt, parsePathsFromResponse, } from "./prompts.js";
function normalizeLlmpath(path, repoPrefix) {
    let p = path.trim();
    if (!p)
        return "";
    const prefix = repoPrefix.replace(/\/+$/, "");
    const prefixWithSlash = `${prefix}/`;
    while (p.startsWith(prefixWithSlash)) {
        p = p.slice(prefixWithSlash.length);
    }
    const segments = p.split("/").filter(Boolean);
    while (segments.length > 1 && segments[0] === segments[1]) {
        segments.splice(1, 1);
    }
    return segments.join("/");
}
export async function getFilesToExplore(tree, repoPrefix, diagramType) {
    try {
        const user = buildFilesToExploreUserPrompt(tree);
        const resolved = resolveChatModel({ route: "fast" });
        const systemPrompt = diagramType
            ? getFilesToExploreSystem(diagramType)
            : FILES_TO_EXPLORE_SYSTEM;
        const response = await resolved.chat.invoke(resolved.prepareMessages([new SystemMessage(systemPrompt), new HumanMessage(user)]));
        const text = normalizeModelContent(response.content);
        const rawPaths = parsePathsFromResponse(text);
        const cleaned = [];
        const seen = new Set();
        for (const raw of rawPaths) {
            const normalized = normalizeLlmpath(raw, repoPrefix);
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            cleaned.push(normalized);
        }
        return cleaned;
    }
    catch (error) {
        console.warn("[repo-explainer] getFilesToExplore failed:", error);
        return [];
    }
}
export async function explainRepoWithLlm(repo, repoContext, instructions, diagramType) {
    try {
        const prompt = buildUserPrompt(repo, repoContext, instructions);
        const resolved = resolveChatModel();
        const systemPrompt = diagramType ? getSystemPrompt(diagramType) : SYSTEM_PROMPT;
        const response = await resolved.chat.invoke(resolved.prepareMessages([new SystemMessage(systemPrompt), new HumanMessage(prompt)]));
        const text = normalizeModelContent(response.content);
        return { explanation: text, success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error generating explanation";
        console.error("[repo-explainer] explainRepoWithLlm failed:", error);
        return { explanation: message, success: false, error: message };
    }
}
//# sourceMappingURL=llm.js.map