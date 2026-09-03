/**
 * Publishing an explanation into the Sources library (design §3.5) — the
 * mindmap seam with different nouns. This module owns only the pure half:
 * the Markdown rendering, the filename, and the convergent creation key.
 * The web route does the storing and the `processDocumentUpload` call, like
 * the mindmap publish route does.
 */
/** Same repo, same commit, same diagram type ⇒ the same source — a
 * re-publish converges instead of duplicating (the mindmap's
 * `mindmap:<id>:<revision>` rule). */
export function makeExplanationCreationKey(owner, repo, sha, diagramType) {
    return `repo-explainer:${owner}/${repo}@${sha}:${diagramType}`;
}
export function makeExplanationFilename(owner, repo, sha) {
    const base = `${owner}-${repo}`.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 80);
    return `${base}-${sha.slice(0, 12)}.md`;
}
/** Strip an existing ```mermaid fence so the render never double-fences. */
export function stripMermaidFence(code) {
    const trimmed = code.trim();
    const match = /^```(?:mermaid)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
    return (match?.[1] ?? trimmed).trim();
}
export function renderExplanationMarkdown(input) {
    const { owner, repo, diagramType, result, generatedAt } = input;
    const fullName = `${owner}/${repo}`;
    const filesSection = result.filesRead.length > 0
        ? result.filesRead.map(path => `- \`${path}\``).join("\n")
        : "_(derived from precomputed context only)_";
    return [
        `# ${fullName} — ${diagramType} explanation`,
        "",
        result.summary.trim(),
        "",
        "## Diagram",
        "",
        "```mermaid",
        stripMermaidFence(result.mermaidCode),
        "```",
        "",
        "## Files consulted",
        "",
        filesSection,
        "",
        "---",
        "",
        [
            `Repository: ${fullName}`,
            `Commit: ${result.provenance.sha}`,
            `Diagram type: ${diagramType}`,
            `Generated: ${generatedAt.toISOString()}`,
            `Skill: ${result.provenance.skillVersion} (${result.provenance.skillHash.slice(0, 12)})`,
            `Prompt: ${result.provenance.promptVersion}`,
            result.provenance.modelId ? `Model: ${result.provenance.modelId}` : undefined,
        ]
            .filter(Boolean)
            .map(line => `> ${line}`)
            .join("\n"),
        "",
    ].join("\n");
}
//# sourceMappingURL=publish.js.map