/**
 * A report as a GitHub issue, for Triage's "Copy as GitHub issue". Shaped
 * like the repository's own issue templates (`.github/ISSUE_TEMPLATE`), so a
 * pasted report reads like one filed there.
 *
 * In English whatever the triager's language: it is written for the issue
 * tracker, not for the screen. It leaves out who reported it and which
 * workspace they were in — a public tracker is the wrong place for either —
 * and the screenshots, which stay in the instance.
 */

import type { FeedbackDetail } from "./contract";

const SEVERITY: Record<string, string> = {
    blocking: "Blocking",
    annoying: "Annoying",
    cosmetic: "Cosmetic",
};

function cell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function feedbackIssueTitle(report: Pick<FeedbackDetail, "kind" | "title">): string {
    return `${report.kind === "bug" ? "[bug]" : "[feat]"}: ${report.title}`;
}

export function feedbackIssueMarkdown(report: FeedbackDetail): string {
    const lines: string[] = [];
    lines.push(report.kind === "bug" ? "## Summary" : "## Problem", "");
    lines.push(report.body.trim() || "_No details given._", "");
    const facts: string[] = [];
    if (report.kind === "bug" && report.severity)
        facts.push(`**Severity:** ${SEVERITY[report.severity] ?? report.severity}`);
    if (report.kind === "idea") facts.push(`**Votes:** ${report.votes}`);
    facts.push(`**Reported:** ${report.createdAt.slice(0, 10)} (in-app feedback #${report.id})`);
    lines.push(facts.join("  \n"), "");

    const context = report.context;
    if (context) {
        const rows: [string, string][] = [];
        if (context.path) rows.push(["Page", `\`${context.path}\``]);
        if (context.appVersion) rows.push(["App version", `\`${context.appVersion}\``]);
        if (context.browser) rows.push(["Browser", context.browser]);
        if (context.viewport)
            rows.push(["Window", `${context.viewport.width} × ${context.viewport.height}`]);
        if (context.screen)
            rows.push([
                "Screen",
                `${context.screen.width} × ${context.screen.height} @${context.screen.pixelRatio}x`,
            ]);
        if (context.theme) rows.push(["Theme", context.theme]);
        if (context.locale) rows.push(["Language", context.locale]);
        for (const [key, value] of Object.entries(context.origin ?? {}))
            rows.push([key, `\`${value}\``]);
        if (rows.length > 0) {
            lines.push("## Context", "", "| | |", "|---|---|");
            for (const [label, value] of rows) lines.push(`| ${cell(label)} | ${cell(value)} |`);
            lines.push("");
        }
        const errors = context.recentErrors ?? [];
        if (errors.length > 0) {
            lines.push(
                `<details><summary>Recent errors in the page (${errors.length})</summary>`,
                "",
                "```",
                ...errors.map(e => `${e.at} ${e.source ?? ""} ${e.message}`.replace(/\s+/g, " ")),
                "```",
                "",
                "</details>",
                ""
            );
        }
    }
    const shots = report.attachmentList?.length ?? report.attachments;
    if (shots > 0)
        lines.push(
            `_${shots} screenshot${shots === 1 ? "" : "s"} attached to the report in LaunchStack (not copied here)._`
        );
    return lines.join("\n").trim() + "\n";
}
