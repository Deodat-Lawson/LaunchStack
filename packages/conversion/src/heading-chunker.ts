/**
 * Heading-Aware Markdown Splitter
 *
 * Splits Markdown content on heading boundaries (#, ##, ###) to produce
 * semantically meaningful sections. Each section carries a hierarchical
 * path (e.g., "Overview > Financial Results > Q3") for contextual retrieval.
 */

export interface HeadingSection {
    /** The heading text (without the # prefix) */
    heading: string;
    /** Hierarchical path built from parent headings, e.g. "Overview > Results > Q3" */
    path: string;
    /** The content under this heading (excluding the heading line itself) */
    content: string;
    /** Heading level (1 = #, 2 = ##, 3 = ###) */
    level: number;
}

const HEADING_REGEX = /^(#{1,3})\s+(.+)$/;

/**
 * Same shape, matched line by line. `HEADING_REGEX` is anchored to the whole
 * string (it is applied to single lines below), so testing a document with
 * it only ever matched a one-line document: `.+$` cannot cross the newline
 * after the first heading. Every real Markdown file failed the check and
 * fell through to plain-text chunking, which is why no chunk ever carried a
 * heading path. This one is multiline.
 */
const ANY_HEADING_LINE = /^#{1,3}[ \t]+\S/m;

/**
 * Returns true if the text contains Markdown headings (lines starting with 1-3 #).
 */
export function hasMarkdownHeadings(text: string): boolean {
    return ANY_HEADING_LINE.test(text);
}

/**
 * Splits Markdown into sections based on heading boundaries.
 * Tracks heading hierarchy to build a structure path.
 *
 * Content before the first heading is assigned to a synthetic "Introduction" section.
 */
export function splitByHeadings(markdown: string): HeadingSection[] {
    const lines = markdown.split("\n");
    const sections: HeadingSection[] = [];

    // Track current heading hierarchy: [level1, level2, level3]
    const headingStack: { level: number; text: string }[] = [];
    let currentHeading = "";
    let currentLevel = 0;
    let currentContent: string[] = [];

    function buildPath(): string {
        return headingStack.map(h => h.text).join(" > ");
    }

    function flushSection() {
        const content = currentContent.join("\n").trim();
        if (content.length > 0) {
            sections.push({
                heading: currentHeading,
                path: buildPath(),
                content,
                level: currentLevel,
            });
        }
        currentContent = [];
    }

    for (const line of lines) {
        const match = HEADING_REGEX.exec(line);
        if (match) {
            // Flush previous section
            flushSection();

            const level = match[1]!.length;
            const headingText = match[2]!.trim();

            // Pop headings at the same or deeper level
            while (
                headingStack.length > 0 &&
                headingStack[headingStack.length - 1]!.level >= level
            ) {
                headingStack.pop();
            }
            headingStack.push({ level, text: headingText });

            currentHeading = headingText;
            currentLevel = level;
        } else {
            currentContent.push(line);
        }
    }

    // Flush the last section
    flushSection();

    return sections;
}
