import type {
  PageContent,
  DocumentChunk,
  ExtractedTable,
  VectorizedChunk,
} from "./types";

import OpenAI from "openai";

// Lazy init to avoid issues if env var missing at module load
let openai: OpenAI | null = null;
function getOpenAI() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export interface ChunkingConfig {
  parentMaxTokens?: number;
  childMaxTokens?: number;
  overlapTokens?: number;
  charsPerToken?: number;
  includePageContext?: boolean;
}

const DEFAULT_CONFIG: Required<ChunkingConfig> = {
  parentMaxTokens: 1000,
  childMaxTokens: 256,
  overlapTokens: 50,
  charsPerToken: 4,
  includePageContext: true,
};

export async function chunkDocument(
  pages: PageContent[],
  config?: ChunkingConfig
): Promise<DocumentChunk[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const pageChunks: DocumentChunk[] = [];

    // Chunk text blocks into Parent-Child hierarchy
    const textChunks = chunkTextBlocks(page.textBlocks, page.pageNumber, cfg);
    pageChunks.push(...textChunks);

    // Tables are treated as Parent chunks (context) with a single Child (itself) for retrieval
    const tableChunks = await chunkTables(page.tables, page.pageNumber, cfg);
    pageChunks.push(...tableChunks);

    for (const chunk of pageChunks) {
      chunk.metadata.chunkIndex = globalChunkIndex++;
      chunk.metadata.totalChunksInPage = pageChunks.length;
      chunk.id = `page-${page.pageNumber}-chunk-${chunk.metadata.chunkIndex}`;
      chunks.push(chunk);
    }
  }

  return chunks;
}

function chunkTextBlocks(
  textBlocks: string[],
  pageNumber: number,
  config: Required<ChunkingConfig>
): DocumentChunk[] {
  if (textBlocks.length === 0) return [];

  const mergedText = textBlocks.join("\n\n");

  const parentMaxChars = config.parentMaxTokens * config.charsPerToken;
  const childMaxChars = config.childMaxTokens * config.charsPerToken;
  const overlapChars = config.overlapTokens * config.charsPerToken;

  // 1. Create Parent Chunks (Context)
  const parentTexts = splitWithOverlap(mergedText, parentMaxChars, overlapChars);

  return parentTexts.map((parentContent, pIndex) => {
    // 2. Create Child Chunks (Retrieval) from Parent Content
    const childTexts = splitWithOverlap(parentContent, childMaxChars, overlapChars);
    
    const children: DocumentChunk[] = childTexts.map((childContent, cIndex) => ({
      id: "", // Assigned later or ignored
      content: childContent,
      type: "text" as const,
      metadata: {
        pageNumber,
        chunkIndex: cIndex,
        totalChunksInPage: childTexts.length,
        isTable: false,
      }
    }));

    return {
      id: "",
      content: parentContent,
      type: "text" as const,
      metadata: {
        pageNumber,
        chunkIndex: pIndex,
        totalChunksInPage: 0, // Set by caller
        isTable: false,
      },
      children
    };
  });
}

async function chunkTables(
  tables: ExtractedTable[],
  pageNumber: number,
  _config: Required<ChunkingConfig>
): Promise<DocumentChunk[]> {
  const tableChunks = await Promise.all(tables.map(async (table, tableIndex) => {
    const tableDescription = await generateTableDescription(table, pageNumber, tableIndex);
    const content = `${tableDescription}\n\n${table.markdown}`;

    // Table is both Parent and Child (1:1 mapping for now)
    const child: DocumentChunk = {
        id: "",
        content,
        type: "table" as const,
        metadata: {
            pageNumber,
            chunkIndex: 0,
            totalChunksInPage: 1,
            isTable: true,
            tableIndex,
            tableDescription,
        }
    };

    return {
      id: "",
      content,
      type: "table" as const,
      metadata: {
        pageNumber,
        chunkIndex: 0,
        totalChunksInPage: 0,
        isTable: true,
        tableIndex,
        tableDescription,
      },
      children: [child]
    };
  }));

  return tableChunks;
}

async function generateTableDescription(
  table: ExtractedTable,
  pageNumber: number,
  tableIndex: number
): Promise<string> {
  // Use regex as fallback description base
  const headers = table.rows[0];
  let contentDescription = "structured data";
  if (headers && headers.length > 0) {
    const headerText = headers.join(" ").toLowerCase();
    if (headerText.includes("date") || headerText.includes("time")) {
      contentDescription = "time-series or dated information";
    } else if (headerText.includes("price") || headerText.includes("cost") || headerText.includes("amount")) {
      contentDescription = "financial or pricing data";
    } else if (headerText.includes("name") && (headerText.includes("role") || headerText.includes("title"))) {
      contentDescription = "personnel or organizational information";
    } else if (headerText.includes("item") || headerText.includes("product") || headerText.includes("sku")) {
      contentDescription = "inventory or product listing";
    } else if (headerText.includes("step") || headerText.includes("action") || headerText.includes("procedure")) {
      contentDescription = "procedural steps or instructions";
    } else if (headers.length <= 3) {
      contentDescription = `data about ${headers.slice(0, 3).join(", ")}`;
    }
  }
  const sizeDescription = `${table.rowCount} rows × ${table.columnCount} columns`;
  const fallbackDesc = `Table from Page ${pageNumber} (Table ${tableIndex + 1}) containing ${contentDescription}. Size: ${sizeDescription}.`;

  // Try LLM summary if available
  const openai = getOpenAI();
  if (!openai) {
    return fallbackDesc;
  }

  try {
    const tablePreview = table.markdown.substring(0, 1000); // Limit context
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Use mini for speed/cost
      messages: [
        {
          role: "system",
          content: "You are a concise data analyst. Summarize the following table in one sentence, describing what kind of data it contains and any key trends or categories. Do not list all rows.",
        },
        {
          role: "user",
          content: `Table headers: ${headers?.join(", ") ?? "None"}\n\nTable content snippet:\n${tablePreview}`,
        },
      ],
      max_tokens: 60,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (summary) {
      return `Table on Page ${pageNumber}: ${summary}`;
    }
  } catch (error) {
    console.warn("Table summary generation failed, using fallback", error);
  }

  return fallbackDesc;
}

function splitWithOverlap(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const searchStart = Math.max(start, end - Math.floor(maxChars * 0.2));
      const searchRegion = text.slice(searchStart, end);

      const sentenceMatch = searchRegion.match(/[.!?]\s+(?=[A-Z])/g);
      if (sentenceMatch) {
        const lastMatch = searchRegion.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]!);
        if (lastMatch !== -1) {
          end = searchStart + lastMatch + 2;
        }
      } else {
        const lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > start + maxChars * 0.5) {
          end = lastSpace;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    const newStart = end - overlapChars;
    if (newStart > start && newStart < text.length) {
      start = newStart;
    } else {
      start = end;
    }

    if (start === end && start < text.length) {
      start = Math.min(start + 1, text.length);
    }
  }

  return chunks;
}

export function estimateTokens(text: string, charsPerToken = 4): number {
  return Math.ceil(text.length / charsPerToken);
}

export function getTotalChunkSize(chunks: DocumentChunk[]): {
  totalChunks: number; // Counting PARENTS or CHILDREN? Usually we care about Parents for context, Children for vector usage.
  textChunks: number;
  tableChunks: number;
  totalCharacters: number;
  estimatedTokens: number;
} {
    // This is for logging mostly. Let's count Parents.
  const textChunks = chunks.filter((c) => c.type === "text");
  const tableChunks = chunks.filter((c) => c.type === "table");
  const totalCharacters = chunks.reduce((sum, c) => sum + c.content.length, 0);

  return {
    totalChunks: chunks.length,
    textChunks: textChunks.length,
    tableChunks: tableChunks.length,
    totalCharacters,
    estimatedTokens: estimateTokens(totalCharacters.toString()),
  };
}

/**
 * Prepares strings for embedding by flattening the hierarchy (extracting all children).
 * Handles Contextual Prepending (Structure Path + Title).
 */
export function prepareForEmbedding(chunks: DocumentChunk[]): string[] {
  const strings: string[] = [];
  
  for (const parent of chunks) {
    if (parent.children && parent.children.length > 0) {
      for (const child of parent.children) {
        let textToEmbed = child.content;
        
        // Contextual Prepending
        const parts: string[] = [];
        if (child.metadata.documentTitle) {
            parts.push(`Document: ${child.metadata.documentTitle}`);
        }
        if (child.metadata.structurePath) {
            parts.push(`Section: ${child.metadata.structurePath}`);
        }
        if (child.metadata.tableDescription) {
            parts.push(`Context: ${child.metadata.tableDescription}`);
        }
        
        if (parts.length > 0) {
            textToEmbed = `${parts.join(" > ")}\nContent: ${textToEmbed}`;
        }

        strings.push(textToEmbed);
      }
    } else {
      // Should not happen with new logic, but fallback to parent content
      strings.push(parent.content);
    }
  }
  return strings;
}

/**
 * Merges generated embeddings back into the hierarchical structure.
 */
export function mergeWithEmbeddings(
  chunks: DocumentChunk[],
  embeddings: number[][]
): VectorizedChunk[] {
  
  // We need to consume embeddings sequentially
  let embeddingIndex = 0;
  
  return chunks.map(parent => {
    const parentChildren = parent.children ?? [];
    const vectorizedChildren: VectorizedChunk[] = [];

    if (parentChildren.length > 0) {
        for (const child of parentChildren) {
            const vector = embeddings[embeddingIndex++];
            if (!vector) {
                throw new Error("Embedding mismatch: fewer embeddings than children");
            }
            // Logic for Matryoshka Short Embedding (first 512 dims)
            const vectorShort = vector.slice(0, 512);

            vectorizedChildren.push({
                content: child.content,
                metadata: child.metadata,
                vector: vector,
                vectorShort: vectorShort,
                // Children don't have children
            });
        }
    } else {
         // Fallback - should not happen if prepareForEmbedding works correctly
         const vector = embeddings[embeddingIndex++];
         if (vector) {
             // If parent was treated as a child (no children), it would be in embeddings.
             // But chunker structure guarantees children.
         }
    }

    return {
      content: parent.content,
      metadata: parent.metadata,
      vector: [], // Parent has no vector in this design
      children: vectorizedChildren
    };
  });
}
