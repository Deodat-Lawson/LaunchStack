/**
 * A document's indexed text, put back together for reading.
 *
 * Each stored section opens with the breadcrumb the chunker wrote, "Title ›
 * Heading › Subheading", then a blank line, then the body; the heading lines
 * themselves are not in the body, since the breadcrumb carries them
 * (packages/conversion/src/ocr-processing/chunker.ts, `contextualize`). Shown
 * as stored, every section starts with the same path and the headings are
 * gone. Read back here, a heading is written once, where the path changes,
 * at its depth.
 */

/** The chunker's separator between breadcrumb steps. */
const CRUMB = " › ";

/** The breadcrumb steps under the title and the body, or null steps when there is no breadcrumb. */
function splitSection(content: string, title: string): { path: string[] | null; body: string } {
    const breakAt = content.indexOf("\n\n");
    if (breakAt <= 0) return { path: null, body: content };
    const firstLine = content.slice(0, breakAt).trim();
    const titleKey = title.trim().toLowerCase();
    // The same narrow shape the chunker's own stripper accepts: one short line
    // holding the separator (or only the title), then a blank line.
    const isBreadcrumb =
        firstLine.length <= 300 &&
        !firstLine.includes("\n") &&
        (firstLine.includes(CRUMB) || firstLine.toLowerCase() === titleKey);
    if (!isBreadcrumb) return { path: null, body: content };
    const steps = firstLine.split(CRUMB).map(step => step.trim());
    if (steps[0]?.toLowerCase() === titleKey) steps.shift();
    return { path: steps, body: content.slice(breakAt + 2) };
}

/** Stored sections, in reading order, as one Markdown document with its headings back. */
export function readableMarkdown(sections: string[], title: string): string {
    const out: string[] = [];
    let previous: string[] = [];
    for (const section of sections) {
        const { path, body } = splitSection(section.trim(), title);
        if (path) {
            let shared = 0;
            while (
                shared < path.length &&
                shared < previous.length &&
                path[shared] === previous[shared]
            ) {
                shared++;
            }
            for (let depth = shared; depth < path.length; depth++) {
                out.push(`${"#".repeat(Math.min(depth + 1, 6))} ${path[depth]}`);
            }
            previous = path;
        }
        const text = body.trim();
        if (text) out.push(text);
    }
    return out.join("\n\n");
}
