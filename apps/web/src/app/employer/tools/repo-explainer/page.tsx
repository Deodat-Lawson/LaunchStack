"use client";

import { Loader2, Network, Share2 } from "lucide-react";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { MermaidDiagram } from "./MermaidDiagram";
import { useRepoExplainer } from "./useRepoExplainer";
import type { DiagramType } from "@launchstack/features/repo-explainer";

const DIAGRAM_TYPE_OPTIONS: { value: DiagramType; label: string }[] = [
    { value: "architecture", label: "Architecture" },
    { value: "component", label: "Component" },
    { value: "sequence", label: "Sequence" },
    { value: "class", label: "Class" },
    { value: "er", label: "ER Diagram" },
];

export default function RepoExplainerPage() {
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
        <ToolsStudioShell>
            <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-10 pt-8">
                <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-brand/10 text-brand-ink dark:bg-brand/15 flex h-10 w-10 items-center justify-center rounded-2xl">
                            <Network className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight text-slate-900 md:text-xl dark:text-slate-50">
                                GitHub Repo Explainer
                            </h1>
                            <p className="text-xs text-slate-500 md:text-sm dark:text-slate-400">
                                Paste any GitHub repository URL and get a summary plus Mermaid
                                diagram.
                            </p>
                        </div>
                    </div>
                </header>

                <section className="border-line bg-panel shadow-1 rounded-2xl border p-4 md:p-5">
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
                                        className="border-line bg-panel-2 text-ink shadow-1 focus:border-brand focus:ring-brand-glow w-full rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2"
                                        value={url}
                                        onChange={e => setUrl(e.target.value)}
                                        disabled={loading}
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="bg-brand hover:bg-brand-hi dark:bg-brand dark:hover:bg-brand-hi inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
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
                                placeholder="<your-github-token> or fine-grained token"
                                className="border-line bg-panel-2 text-ink shadow-1 focus:border-brand focus:ring-brand-glow w-full rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2"
                                value={githubToken}
                                onChange={e => setGithubToken(e.target.value)}
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                Diagram type
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {DIAGRAM_TYPE_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        disabled={loading}
                                        onClick={() => setDiagramType(opt.value)}
                                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                                            diagramType === opt.value
                                                ? "border-brand bg-brand-soft text-brand-ink ring-brand ring-1"
                                                : "border-line bg-panel-2 text-ink-2 hover:border-brand"
                                        } ${loading ? "cursor-not-allowed opacity-50" : ""}`}
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
                                placeholder='E.g. "Focus on API design and generate a UML component diagram."'
                                className="border-line bg-panel-2 text-ink shadow-1 focus:border-brand focus:ring-brand-glow min-h-[70px] w-full rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2"
                                value={instructions}
                                onChange={e => setInstructions(e.target.value)}
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
                        <div className="border-line bg-surface-sunk text-ink-3 mt-4 rounded-md border border-dashed px-3 py-2 text-xs">
                            Tip: try{" "}
                            <button
                                type="button"
                                className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
                                onClick={() => setUrl("https://github.com/facebook/react")}
                            >
                                https://github.com/facebook/react
                            </button>{" "}
                            with instructions like{" "}
                            <button
                                type="button"
                                className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
                                onClick={() =>
                                    setInstructions(
                                        "Generate a high-level UML diagram of the main components and how they interact."
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
                    <section className="border-line bg-panel shadow-1 rounded-2xl border p-4 md:p-5">
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                {result.repo}
                            </p>
                        </div>
                        {summary && (
                            <div className="border-line bg-surface-sunk text-ink-2 mb-4 rounded-md border p-4 text-sm leading-relaxed">
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
                            <pre className="border-line bg-surface-sunk text-ink-2 overflow-x-auto rounded-md border p-3 text-xs">
                                {result.explanation || "No diagram generated."}
                            </pre>
                        )}
                        {result.umlJson && (
                            <details className="border-line bg-surface-sunk mt-4 rounded-md border p-3">
                                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    UML JSON response
                                </summary>
                                <pre className="border-line bg-panel-2 text-ink-2 mt-2 overflow-x-auto rounded-md border p-3 text-xs">
                                    {JSON.stringify(result.umlJson, null, 2)}
                                </pre>
                            </details>
                        )}
                    </section>
                )}
            </main>
        </ToolsStudioShell>
    );
}
