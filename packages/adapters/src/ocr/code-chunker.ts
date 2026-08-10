import type { DocumentChunk, PageContent } from "./types";

const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
  ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".sh", ".bash", ".sql",
  ".r", ".lua", ".pl", ".scala", ".css", ".scss", ".less",
]);

export function isCodeFile(filename?: string): boolean {
  if (!filename) return false;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return CODE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

const BLOCK_START_PATTERNS: Record<string, RegExp[]> = {
  python: [
    /^(async\s+)?def\s+\w+/,
    /^class\s+\w+/,
    /^@\w+/,
  ],
  javascript: [
    /^(export\s+)?(async\s+)?function\s+\w+/,
    /^(export\s+)?class\s+\w+/,
    /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
    /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?function/,
    /^(export\s+)?default\s+/,
    /^(export\s+)?interface\s+\w+/,
    /^(export\s+)?type\s+\w+/,
    /^(export\s+)?enum\s+\w+/,
  ],
  java: [
    /^(public|private|protected|static|\s)*(class|interface|enum)\s+\w+/,
    /^(public|private|protected|static|\s)*([\w<>\[\]]+)\s+\w+\s*\(/,
  ],
  go: [
    /^func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/,
    /^type\s+\w+\s+(struct|interface)/,
  ],
  rust: [
    /^(pub\s+)?(fn|struct|enum|trait|impl|mod|type)\s+/,
  ],
  css: [
    /^[.#@]\w/,
    /^\w[\w-]*\s*\{/,
  ],
  generic: [
    /^(export\s+)?(function|class|def|fn|func|sub|proc)\s+/,
  ],
};

function detectLanguageFamily(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".py": "python",
    ".js": "javascript", ".ts": "javascript", ".jsx": "javascript", ".tsx": "javascript",
    ".java": "java", ".kt": "java",
    ".go": "go",
    ".rs": "rust",
    ".css": "css", ".scss": "css", ".less": "css",
  };
  return map[ext] ?? "generic";
}

interface CodeBlock {
  header: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

function splitIntoCodeBlocks(source: string, filename: string): CodeBlock[] {
  const lang = detectLanguageFamily(filename);
  const patterns = [
    ...(BLOCK_START_PATTERNS[lang] ?? []),
    ...(lang !== "generic" ? BLOCK_START_PATTERNS.generic! : []),
  ];

  const lines = source.split("\n");
  const blocks: CodeBlock[] = [];
  let currentHeader = `[${filename} imports/top-level]`;
  let currentLines: string[] = [];
  let currentStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();

    const isBlockStart =
      trimmed.length > 0 &&
      line.length === trimmed.length &&
      patterns.some((p) => p.test(trimmed));

    if (isBlockStart && currentLines.length > 0) {
      blocks.push({
        header: currentHeader,
        content: currentLines.join("\n"),
        lineStart: currentStart,
        lineEnd: i,
      });
      currentHeader = trimmed.slice(0, 120);
      currentLines = [line];
      currentStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    blocks.push({
      header: currentHeader,
      content: currentLines.join("\n"),
      lineStart: currentStart,
      lineEnd: lines.length,
    });
  }

  return blocks;
}

const CODE_PARENT_MAX_CHARS = 6000;
const CODE_CHILD_MAX_CHARS = 1500;

export function chunkCodeFile(
  pages: PageContent[],
  filename?: string,
): DocumentChunk[] {
  const fullText = pages.map((p) => p.textBlocks.join("\n")).join("\n");
  if (!filename || fullText.length === 0) {
    return [];
  }

  const blocks = splitIntoCodeBlocks(fullText, filename);
  const chunks: DocumentChunk[] = [];
  let parentBuffer: CodeBlock[] = [];
  let parentCharCount = 0;

  const flushParent = () => {
    if (parentBuffer.length === 0) return;
    const parentContent = parentBuffer.map((b) => b.content).join("\n\n");
    const headerLabel = parentBuffer.length === 1
      ? parentBuffer[0]!.header
      : `${parentBuffer[0]!.header} ... ${parentBuffer[parentBuffer.length - 1]!.header}`;

    const children: DocumentChunk[] = [];
    for (const block of parentBuffer) {
      if (block.content.length <= CODE_CHILD_MAX_CHARS) {
        children.push({
          id: "",
          content: block.content,
          type: "text",
          metadata: {
            pageNumber: 1,
            chunkIndex: children.length,
            totalChunksInPage: 0,
            isTable: false,
            structurePath: `${filename}::${block.header}`,
            lineStart: block.lineStart,
            lineEnd: block.lineEnd,
          },
        });
      } else {
        let offset = 0;
        while (offset < block.content.length) {
          let end = Math.min(offset + CODE_CHILD_MAX_CHARS, block.content.length);
          if (end < block.content.length) {
            const lastNl = block.content.lastIndexOf("\n", end);
            if (lastNl > offset + CODE_CHILD_MAX_CHARS * 0.4) end = lastNl;
          }
          children.push({
            id: "",
            content: block.content.slice(offset, end),
            type: "text",
            metadata: {
              pageNumber: 1,
              chunkIndex: children.length,
              totalChunksInPage: 0,
              isTable: false,
              structurePath: `${filename}::${block.header}`,
            },
          });
          offset = end;
        }
      }
    }

    chunks.push({
      id: `code-chunk-${chunks.length}`,
      content: parentContent,
      type: "text",
      metadata: {
        pageNumber: 1,
        chunkIndex: chunks.length,
        totalChunksInPage: 0,
        isTable: false,
        structurePath: `${filename}::${headerLabel}`,
      },
      children,
    });

    parentBuffer = [];
    parentCharCount = 0;
  };

  for (const block of blocks) {
    if (parentCharCount + block.content.length > CODE_PARENT_MAX_CHARS && parentBuffer.length > 0) {
      flushParent();
    }
    parentBuffer.push(block);
    parentCharCount += block.content.length;
  }
  flushParent();

  for (const chunk of chunks) {
    chunk.metadata.totalChunksInPage = chunks.length;
    if (chunk.children) {
      for (const child of chunk.children) {
        child.metadata.totalChunksInPage = chunk.children.length;
      }
    }
  }

  return chunks;
}
