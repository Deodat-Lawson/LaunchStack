"use client";

import { Loader2, Network, Share2 } from "lucide-react";
import { MermaidDiagram } from "~/app/employer/tools/repo-explainer/MermaidDiagram";
import { useRepoExplainer } from "~/app/employer/tools/repo-explainer/useRepoExplainer";
import type { DiagramType } from "@launchstack/features/repo-explainer";

const DIAGRAM_TYPE_OPTIONS: { value: DiagramType; label: string; description: string }[] = [
  { value: "architecture", label: "Architecture", description: "High-level system overview with modules and layers" },
  { value: "component", label: "Component", description: "Module boundaries and dependency relationships" },
  { value: "sequence", label: "Sequence", description: "Request/response flows and interactions" },
  { value: "class", label: "Class", description: "OOP structure with inheritance and interfaces" },
  { value: "er", label: "ER Diagram", description: "Database entities and their relationships" },
];

interface RepoExplainerPanelProps {
  initialRepoUrl?: string | null;
}

export function RepoExplainerPanel({ initialRepoUrl }: RepoExplainerPanelProps) {
  const {
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
  } = useRepoExplainer({ initialUrl: initialRepoUrl });

  // Extract repo name for contextual header (e.g., "owner/repo" from URL)
  const repoName = url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-lg shadow-purple-500/20">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {initialRepoUrl && repoName
                ? `Diagram for ${repoName}`
                : "GitHub Repo Explainer"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {initialRepoUrl
                ? "Generate a summary and architecture diagram for this repository."
                : "Paste a GitHub repo URL to generate a summary and architecture diagram."}
            </p>
          </div>
        </div>

        {/* Form */}
        <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="repo-url-panel" className="text-xs font-medium text-muted-foreground">
                GitHub repository URL
              </label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  id="repo-url-panel"
                  type="text"
                  placeholder="https://github.com/owner/repo or owner/repo"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-950"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4" />
                      Generate diagram
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="repo-token-panel" className="text-xs font-medium text-muted-foreground">
                GitHub token (optional, required for private repos)
              </label>
              <input
                id="repo-token-panel"
                type="password"
                placeholder="ghp_... or fine-grained token"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-950"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Diagram type
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
                {DIAGRAM_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={loading}
                    onClick={() => setDiagramType(opt.value)}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${
                      diagramType === opt.value
                        ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 ring-1 ring-purple-500"
                        : "border-border bg-background hover:border-purple-300 hover:bg-muted/50"
                    } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className={`text-xs font-semibold ${diagramType === opt.value ? "text-purple-700 dark:text-purple-300" : "text-foreground"}`}>
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="repo-instructions-panel" className="text-xs font-medium text-muted-foreground">
                Additional instructions (optional)
              </label>
              <textarea
                id="repo-instructions-panel"
                placeholder='E.g. "Focus on API design and generate a UML component diagram." or "Generate a sequence diagram for the authentication flow."'
                className="min-h-[70px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-950"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={loading}
              />
            </div>
          </form>

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {!error && !loading && !result && !initialRepoUrl && (
            <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Tips:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Try <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setUrl("https://github.com/facebook/react")}>facebook/react</button> to see it in action</li>
                <li>Use instructions like &quot;Generate a component diagram&quot; or &quot;Focus on the data flow&quot;</li>
                <li>For private repos, add a GitHub personal access token</li>
              </ul>
            </div>
          )}
        </section>

        {/* Results */}
        {result && (
          <section className="rounded-2xl border border-border bg-background p-5 shadow-sm space-y-4">
            <p className="text-sm font-medium text-foreground">{result.repo}</p>

            {summary && (
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Summary
                </h3>
                <p className="whitespace-pre-wrap text-foreground">{summary}</p>
              </div>
            )}

            {mermaidCode ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Architecture Diagram
                </h3>
                <MermaidDiagram code={mermaidCode} repoName={result.repo} />
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                {result.explanation || "No diagram generated."}
              </pre>
            )}

            {result.umlJson && (
              <details className="rounded-md border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  UML JSON response
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                  {JSON.stringify(result.umlJson, null, 2)}
                </pre>
              </details>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
