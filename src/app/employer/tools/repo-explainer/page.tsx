"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Brain, Github, Loader2, Network, Share2 } from "lucide-react";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import homeStyles from "~/styles/Employer/Home.module.css";
import { MermaidDiagram } from "./MermaidDiagram";
import { useRepoExplainer } from "./useRepoExplainer";
import type { DiagramType } from "~/lib/repo-explainer/types";

const DIAGRAM_TYPE_OPTIONS: { value: DiagramType; label: string }[] = [
  { value: "architecture", label: "Architecture" },
  { value: "component", label: "Component" },
  { value: "sequence", label: "Sequence" },
  { value: "class", label: "Class" },
  { value: "er", label: "ER Diagram" },
];

export default function RepoExplainerPage() {
  const router = useRouter();
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
  } = useRepoExplainer();

  return (
    <div className={homeStyles.container}>
      <nav className={homeStyles.navbar}>
        <div className={homeStyles.navContent}>
          <div
            className={homeStyles.logoContainer}
            onClick={() => router.push("/employer/home")}
            onKeyDown={(e) => e.key === "Enter" && router.push("/employer/home")}
            role="button"
            tabIndex={0}
          >
            <Brain className={homeStyles.logoIcon} />
            <span className={homeStyles.logoText}>PDR AI</span>
          </div>
          <div className={homeStyles.navActions}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => router.push("/employer/home")}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Home
            </button>
            <ThemeToggle />
            <ProfileDropdown />
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-10 pt-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-600/10 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50 md:text-xl">
                GitHub Repo Explainer
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 md:text-sm">
                Paste any GitHub repository URL and get a summary plus Mermaid diagram.
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/60 md:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="repo-url"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                GitHub repository URL
              </label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex-1">
                  <input
                    id="repo-url"
                    type="text"
                    placeholder="https://github.com/owner/repo or owner/repo"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-purple-400 dark:focus:ring-purple-950"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-purple-500 dark:hover:bg-purple-400"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating…
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
              <label
                htmlFor="github-token"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                GitHub token (optional, required for private repos)
              </label>
              <input
                id="github-token"
                type="password"
                placeholder="ghp_... or fine-grained token"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-purple-400 dark:focus:ring-purple-950"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Diagram type
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DIAGRAM_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={loading}
                    onClick={() => setDiagramType(opt.value)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                      diagramType === opt.value
                        ? "border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500 dark:bg-purple-900/20 dark:text-purple-300"
                        : "border-slate-300 bg-white text-slate-700 hover:border-purple-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="instructions"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Additional instructions (optional)
              </label>
              <textarea
                id="instructions"
                placeholder="E.g. &quot;Focus on API design and generate a UML component diagram.&quot;"
                className="min-h-[70px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-purple-400 dark:focus:ring-purple-950"
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

          {!error && !loading && !result && (
            <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              Tip: try{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
                onClick={() =>
                  setUrl("https://github.com/facebook/react")
                }
              >
                https://github.com/facebook/react
              </button>{" "}
              with instructions like{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
                onClick={() =>
                  setInstructions(
                    "Generate a high-level UML diagram of the main components and how they interact.",
                  )
                }
              >
                &quot;Generate a high-level UML diagram…&quot;
              </button>
              .
            </div>
          )}
        </section>

        {result && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/60 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                {result.repo}
              </p>
            </div>
            {summary && (
              <div className="mb-4 rounded-md border border-slate-200 bg-slate-50/50 p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Summary
                </h3>
                <p className="whitespace-pre-wrap">{summary}</p>
              </div>
            )}
            {mermaidCode ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Architecture Diagram
                </h3>
                <MermaidDiagram code={mermaidCode} repoName={result.repo} />
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                {result.explanation || "No diagram generated."}
              </pre>
            )}
            {result.umlJson && (
              <details className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  UML JSON response
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {JSON.stringify(result.umlJson, null, 2)}
                </pre>
              </details>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
