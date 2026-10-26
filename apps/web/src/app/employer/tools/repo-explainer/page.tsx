"use client";

import { Loader2, Network, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { MermaidDiagram } from "./MermaidDiagram";
import { useRepoExplainer } from "./useRepoExplainer";
import type { DiagramType } from "@launchstack/pipelines/repo-explainer";

/** Labels are `tools.repoExplainer.diagramTypes.<value>`. */
const DIAGRAM_TYPE_OPTIONS = [
    "architecture",
    "component",
    "sequence",
    "class",
    "er",
] as const satisfies readonly DiagramType[];

const FIELD_LABEL = "text-ink-2 text-xs";
const SECTION_HEADING = "text-ink-3 text-xs font-semibold uppercase tracking-wide";
/** A kit link button that sits inside the tip's sentence. */
const TIP_LINK =
    "h-auto whitespace-normal p-0 align-baseline text-xs font-normal underline underline-offset-2";

export default function RepoExplainerPage() {
    const t = useTranslations("tools.repoExplainer");
    const tRegistry = useTranslations("tools.registry.repoExplainer");
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
                        <div className="bg-brand-soft text-brand-ink flex h-10 w-10 items-center justify-center rounded-2xl">
                            <Network className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-ink text-lg font-semibold tracking-tight md:text-xl">
                                {t("title")}
                            </h1>
                            <p className="text-ink-3 text-xs md:text-sm">
                                {tRegistry("description")}
                            </p>
                        </div>
                    </div>
                </header>

                <section className="border-line bg-panel shadow-1 rounded-2xl border p-4 md:p-5">
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="repo-url" className={FIELD_LABEL}>
                                {t("urlLabel")}
                            </Label>
                            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                                <div className="flex-1">
                                    <Input
                                        id="repo-url"
                                        type="text"
                                        placeholder={t("urlPlaceholder")}
                                        value={url}
                                        onChange={e => setUrl(e.target.value)}
                                        disabled={loading}
                                        required
                                    />
                                </div>
                                <Button type="submit" disabled={loading} className="gap-1.5">
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            {t("generating")}
                                        </>
                                    ) : (
                                        <>
                                            <Share2 className="h-4 w-4" />
                                            {t("generate")}
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="github-token" className={FIELD_LABEL}>
                                {t("tokenLabel")}
                            </Label>
                            <Input
                                id="github-token"
                                type="password"
                                placeholder={t("tokenPlaceholder")}
                                value={githubToken}
                                onChange={e => setGithubToken(e.target.value)}
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label id="diagram-type-label" className={FIELD_LABEL}>
                                {t("diagramType")}
                            </Label>
                            <ToggleGroup
                                type="single"
                                size="sm"
                                value={diagramType}
                                // Single-select with no "none": ignore the deselect a
                                // second click on the active item would send.
                                onValueChange={value => {
                                    if (value) setDiagramType(value as DiagramType);
                                }}
                                disabled={loading}
                                aria-labelledby="diagram-type-label"
                                className="border-line bg-surface-sunk w-fit max-w-full justify-start gap-0.5 overflow-x-auto rounded-md border p-0.5"
                            >
                                {DIAGRAM_TYPE_OPTIONS.map(value => (
                                    <ToggleGroupItem
                                        key={value}
                                        value={value}
                                        className="data-[state=on]:bg-panel data-[state=on]:shadow-1 h-7 shrink-0 rounded-[5px] px-2.5 text-xs"
                                    >
                                        {t(`diagramTypes.${value}`)}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="instructions" className={FIELD_LABEL}>
                                {t("instructionsLabel")}
                            </Label>
                            <Textarea
                                id="instructions"
                                placeholder={t("instructionsPlaceholder")}
                                className="min-h-[70px]"
                                value={instructions}
                                onChange={e => setInstructions(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                    </form>

                    {error && (
                        <div
                            role="alert"
                            className="border-danger/40 bg-danger-soft text-danger-ink mt-3 rounded-md border px-3 py-2 text-xs"
                        >
                            {error}
                        </div>
                    )}

                    {!error && !loading && !result && (
                        <div className="border-line bg-surface-sunk text-ink-3 mt-4 rounded-md border border-dashed px-3 py-2 text-xs">
                            {t.rich("tip", {
                                url: chunks => (
                                    <Button
                                        type="button"
                                        variant="link"
                                        className={TIP_LINK}
                                        onClick={() => setUrl("https://github.com/facebook/react")}
                                    >
                                        {chunks}
                                    </Button>
                                ),
                                example: chunks => (
                                    <Button
                                        type="button"
                                        variant="link"
                                        className={TIP_LINK}
                                        onClick={() => setInstructions(t("tipInstruction"))}
                                    >
                                        {chunks}
                                    </Button>
                                ),
                            })}
                        </div>
                    )}
                </section>

                {result && (
                    <section className="border-line bg-panel shadow-1 rounded-2xl border p-4 md:p-5">
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <p className="text-ink text-sm font-medium">{result.repo}</p>
                        </div>
                        {summary && (
                            <div className="border-line bg-surface-sunk text-ink-2 mb-4 rounded-md border p-4 text-sm leading-relaxed">
                                <h3 className={`${SECTION_HEADING} mb-2`}>{t("summary")}</h3>
                                <p className="whitespace-pre-wrap">{summary}</p>
                            </div>
                        )}
                        {mermaidCode ? (
                            <div>
                                <h3 className={`${SECTION_HEADING} mb-2`}>
                                    {t("architectureDiagram")}
                                </h3>
                                <MermaidDiagram code={mermaidCode} repoName={result.repo} />
                            </div>
                        ) : (
                            <pre className="border-line bg-surface-sunk text-ink-2 overflow-x-auto rounded-md border p-3 text-xs">
                                {result.explanation || t("noDiagram")}
                            </pre>
                        )}
                        {result.umlJson && (
                            <details className="border-line bg-surface-sunk mt-4 rounded-md border p-3">
                                <summary className={`${SECTION_HEADING} cursor-pointer`}>
                                    {t("umlJson")}
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
