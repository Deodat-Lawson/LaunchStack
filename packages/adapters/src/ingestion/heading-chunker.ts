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
 * Returns true if the text contains Markdown headings (lines starting with 1-3 #).
 */
export function hasMarkdownHeadings(text: string): boolean {
  return HEADING_REGEX.test(text);
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
    return headingStack.map((h) => h.text).join(" > ");
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
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
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
