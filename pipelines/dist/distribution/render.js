/** Same program, same organisation, same run ⇒ the same source. */
export function makeDossierCreationKey(programId, orgId, runId) {
    return `distribution:${programId}:${orgId}:${runId}`;
}
export function makeDossierFilename(org) {
    const base = org.name
        .replace(/[^a-zA-Z0-9\s\-_]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80) || "partner";
    return `${base}-dossier.md`;
}
function cite(ids) {
    return ids.map(id => `[E${id}]`).join(" ");
}
export function renderDossierMarkdown(input) {
    const { org, dossier, evidence, fit, program } = input;
    const territory = input.territory
        ? `${input.territory.region ? `${input.territory.region}, ` : ""}${input.territory.country}`
        : "—";
    const lines = [];
    lines.push(`# ${org.name} — ${input.kind} dossier`, "");
    lines.push(`**Program:** ${program.name} · **Wanted as:** ${input.kind} · **Territory:** ${territory} · **Fit:** ${fit.score}/100`, "");
    if (org.domain)
        lines.push(`Website: https://${org.domain}`, "");
    lines.push("## Summary", "", dossier?.summary ?? "_No dossier could be produced within budget; see evidence below._", "");
    lines.push("## Fit", "", fit.rationale, "");
    lines.push(`| Category overlap | Territory | Role | Evidence depth | Freshness | Size | Known to us | Total |`, `|---|---|---|---|---|---|---|---|`, `| ${fit.breakdown.categoryOverlap} | ${fit.breakdown.territoryMatch} | ${fit.breakdown.roleMatch} | ${fit.breakdown.evidenceDepth} | ${fit.breakdown.freshness} | ${fit.breakdown.sizeFit} | ${fit.breakdown.knownSignal} | **${fit.breakdown.total}** |`, "");
    if (dossier) {
        lines.push("## Roles", "", dossier.roles.length
            ? dossier.roles.map(r => `- ${r}`).join("\n")
            : "_Not established._", "");
        const section = (title, rows) => {
            lines.push(`## ${title}`, "", rows.length ? rows.join("\n") : "_Not established._", "");
        };
        section("Brands carried", dossier.brandsCarried.map(b => `- ${b.brand} ${cite(b.evidenceIds)}`));
        section("Territories served", dossier.territories.map(t => `- ${t.territory} ${cite(t.evidenceIds)}`));
        section("Retail coverage", dossier.retailCoverage.map(r => `- ${r.account} ${cite(r.evidenceIds)}`));
        section("Certifications", dossier.certifications.map(c => `- ${c.certification} ${cite(c.evidenceIds)}`));
        section("Decision makers", dossier.decisionMakers.map(d => `- ${d.title}${d.name ? ` — ${d.name}` : ""} ${cite(d.evidenceIds)}`));
        section("Contact channels", dossier.contactChannels.map(c => `- ${c.channel}: ${c.value} ${cite(c.evidenceIds)}`));
        section("Risks", dossier.risks.map(r => `- ${r.risk} ${cite(r.evidenceIds)}`));
        if (dossier.openQuestions.length)
            lines.push("## Open questions", "", dossier.openQuestions.map(q => `- ${q}`).join("\n"), "");
    }
    if (input.riskFlags.length)
        lines.push("## Flags", "", input.riskFlags.map(f => `- ${f}`).join("\n"), "");
    if (input.screening) {
        lines.push("## Compliance screening", "");
        if (input.screening.status === "not_run")
            lines.push("_Not run (no screening provider configured)._", "");
        else if (input.screening.status === "clear")
            lines.push(`_No matches (${input.screening.provider})._`, "");
        else {
            lines.push(`**Flagged** by ${input.screening.provider}. Advisory — confirm before acting.`, "");
            for (const f of input.screening.flags ?? [])
                lines.push(`- ${f.matchedName} (score ${f.score.toFixed(2)}; ${f.topics.join(", ") || "no topics"})`);
            lines.push("");
        }
    }
    lines.push("## Evidence", "");
    if (evidence.length === 0)
        lines.push("_None recorded._", "");
    for (const e of evidence) {
        lines.push(`- **[E${e.id}]** _${e.kind}_ — ${e.claim}`);
        if (e.quote)
            lines.push(`  > ${e.quote.replace(/\n+/g, " ")}`);
        lines.push(`  Source: ${e.sourceUrl}`);
    }
    lines.push("", "---", "");
    lines.push(...[
        `Organisation key: ${org.resolveKey}`,
        `Run: ${input.provenance.runId}`,
        `Generated: ${input.generatedAt.toISOString()}`,
        `Playbook: ${input.provenance.playbookHash.slice(0, 12)}`,
        `Prompt: ${input.provenance.promptVersion}`,
        input.provenance.modelId ? `Model: ${input.provenance.modelId}` : undefined,
    ]
        .filter(Boolean)
        .map(l => `> ${l}`));
    return lines.join("\n");
}
//# sourceMappingURL=render.js.map