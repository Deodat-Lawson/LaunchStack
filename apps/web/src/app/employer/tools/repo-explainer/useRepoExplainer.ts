"use client";

import { useState, useCallback, useEffect } from "react";
import type { DiagramType, RepoExplanationResult } from "~/lib/repo-explainer/types";

interface ApiResponse {
  success: boolean;
  message?: string;
  data?: RepoExplanationResult;
}

interface UseRepoExplainerOptions {
  initialUrl?: string | null;
}

export function useRepoExplainer(options?: UseRepoExplainerOptions) {
  const [url, setUrl] = useState(options?.initialUrl ?? "");
  const [instructions, setInstructions] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [diagramType, setDiagramType] = useState<DiagramType>("architecture");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RepoExplanationResult | null>(null);

  // Sync URL when initialUrl prop changes (e.g. user clicks a different archive)
  useEffect(() => {
    if (options?.initialUrl) {
      setUrl(options.initialUrl);
      setResult(null);
      setError(null);
    }
  }, [options?.initialUrl]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setResult(null);

      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError("Please enter a GitHub repository URL.");
        return;
      }

      setLoading(true);
      try {
        const response = await fetch("/api/repo-explainer", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(githubToken.trim()
              ? { "X-GitHub-Token": githubToken.trim() }
              : {}),
          },
          body: JSON.stringify({
            url: trimmedUrl,
            instructions: instructions.trim() || undefined,
            diagramType,
          }),
        });

        const payload = (await response.json()) as ApiResponse;
        if (!response.ok || !payload.success || !payload.data) {
          setError(
            payload.message ??
              "We could not generate an explanation for this repository. Please try again.",
          );
          return;
        }

        setResult(payload.data);
      } catch (err) {
        console.error("[repo-explainer] request error:", err);
        setError(
          "Something went wrong while talking to the repo explainer. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [url, instructions, githubToken, diagramType],
  );

  const summary = result?.summary ?? null;
  const mermaidCode = result?.mermaidCode ?? null;

  return {
    url,
    setUrl,
    instructions,
    setInstructions,
    githubToken,
    setGithubToken,
    diagramType,
    setDiagramType,
    loading,
    error,
    result,
    summary,
    mermaidCode,
    handleSubmit,
  };
}
