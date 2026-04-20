import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, normalizeModelContent } from "~/app/api/agents/documentQ&A/services";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services";
import { env } from "~/env";
import type { DiagramType, RepoInfo } from "./types";
import {
  FILES_TO_EXPLORE_SYSTEM,
  SYSTEM_PROMPT,
  getFilesToExploreSystem,
  getSystemPrompt,
  buildFilesToExploreUserPrompt,
  buildUserPrompt,
  parsePathsFromResponse,
} from "./prompts";

function normalizeLlmpath(path: string, repoPrefix: string): string {
  let p = path.trim();
  if (!p) return "";

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

function getDefaultModel(): AIModelType {
  return (env.server.REPO_EXPLAINER_MODEL as AIModelType) || ("gpt-4o" as AIModelType);
}

export async function getFilesToExplore(
  tree: string,
  repoPrefix: string,
  diagramType?: DiagramType,
): Promise<string[]> {
  try {
    const user = buildFilesToExploreUserPrompt(tree);
    const model = getChatModel(getDefaultModel());
    const systemPrompt = diagramType
      ? getFilesToExploreSystem(diagramType)
      : FILES_TO_EXPLORE_SYSTEM;
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(user),
    ]);
    const text = normalizeModelContent(response);
    const rawPaths = parsePathsFromResponse(text);

    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawPaths) {
      const normalized = normalizeLlmpath(raw, repoPrefix);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      cleaned.push(normalized);
    }
    return cleaned;
  } catch (error) {
    console.warn("[repo-explainer] getFilesToExplore failed:", error);
    return [];
  }
}

export async function explainRepoWithLlm(
  repo: RepoInfo,
  repoContext: string,
  instructions: string | null | undefined,
  diagramType?: DiagramType,
): Promise<{ explanation: string; success: boolean; error?: string }> {
  try {
    const prompt = buildUserPrompt(repo, repoContext, instructions);
    const model = getChatModel(getDefaultModel());
    const systemPrompt = diagramType
      ? getSystemPrompt(diagramType)
      : SYSTEM_PROMPT;
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ]);
    const text = normalizeModelContent(response);
    return { explanation: text, success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error generating explanation";
    console.error("[repo-explainer] explainRepoWithLlm failed:", error);
    return { explanation: message, success: false, error: message };
  }
}

