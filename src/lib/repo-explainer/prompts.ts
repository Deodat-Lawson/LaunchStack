import type { DiagramType, RepoInfo } from "./types";

const FILE_SELECTION_FOCUS: Record<DiagramType, string> = {
  architecture: `Prioritize: README/docs, config (package.json, requirements.txt, etc.), main entry points, routers, service files, and key source files that reveal the high-level structure.`,
  sequence: `Prioritize: API route handlers, controller files, service/use-case files, middleware, and any files that show request/response flows or inter-service communication.`,
  class: `Prioritize: model/entity definitions, class files, type definitions, interfaces, abstract classes, and inheritance hierarchies. Focus on OOP structure.`,
  er: `Prioritize: database schema files, ORM models, migration files, type definitions for entities, and any files defining relationships between data models.`,
  component: `Prioritize: main entry points, module definitions, package boundaries, service registrations, dependency injection configs, and files that define component interfaces.`,
};

export function getFilesToExploreSystem(diagramType: DiagramType = "architecture"): string {
  const focus = FILE_SELECTION_FOCUS[diagramType];
  return `You are a principal engineer. Given a repository's directory tree, you must choose which files are most valuable to read for generating a ${diagramType} diagram.

CRITICAL PATH RULES:
- The tree below has a root label like \`└── owner/repo/\`. That label is for display ONLY and is NOT part of any file path. Paths start from the FIRST LEVEL INSIDE that root.
- Example: if the tree shows:
    └── fastapi/fastapi/
        ├── README.md
        ├── fastapi/
        │   ├── applications.py
  then the correct paths are \`README.md\` and \`fastapi/applications.py\`.
  WRONG: \`fastapi/fastapi/README.md\` or \`fastapi/fastapi/fastapi/applications.py\`.
- Return ONLY file paths (not directories), one per line. No explanations, no bullets, no markdown.
- ${focus}
- Prefer a small set (up to 15 paths) so the list stays focused.

Output format: plain text, exactly one path per line. Example:

README.md
package.json
src/main.py
src/utils.py`;
}

export const FILES_TO_EXPLORE_SYSTEM = getFilesToExploreSystem("architecture");

const FILES_TO_EXPLORE_USER_TEMPLATE = `Directory tree of the repository:
List the file paths to read (one per line, relative to repo root). No other text.

<tree>
{tree}
</tree>
`;

export function buildFilesToExploreUserPrompt(tree: string): string {
  return FILES_TO_EXPLORE_USER_TEMPLATE.replace("{tree}", tree);
}

export function parsePathsFromResponse(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  let raw = text.trim();

  // Strip code fences if the model wrapped the output
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[\w-]*\n?/, "");
    raw = raw.replace(/\n?```\s*$/, "");
  }

  const paths: string[] = [];
  for (const lineRaw of raw.split("\n")) {
    let line = lineRaw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<")) continue;

    // Strip bullets like "- path"
    line = line.replace(/^[\-\*]\s+/, "").trim();

    // Very simple guard: ignore lines that look like sentences
    if (!line || line.includes(" ")) continue;

    paths.push(line);
  }
  return paths;
}

const DIAGRAM_TYPE_INSTRUCTIONS: Record<DiagramType, string> = {
  architecture: `MERMAID RULES — readable, valid syntax:
- Use flowchart TD (not "graph")
- Include 8-15 nodes MAXIMUM. Each node = a logical MODULE or LAYER, not an individual file
  - Group related files into one node (e.g. "API Routes" not "route1.ts, route2.ts, route3.ts")
- Add short edge labels (2-3 words): A -->|"calls"| B
- Use subgraphs for layers (Frontend, Backend, Database, etc.)
- Nested subgraphs are allowed and encouraged for clarity:
  subgraph Backend
    subgraph API
      A["Routes"]
      B["Middleware"]
    end
    subgraph Services
      C["Auth"]
      D["Storage"]
    end
  end
- Every subgraph MUST be closed with "end"
- Use simple node IDs (A, B, C, ..., Z, AA, AB). No spaces in IDs.
- Labels in quotes: A["Auth Service"]
- One statement per line.
- KEEP IT SIMPLE — a readable diagram with 10 clear nodes is better than a cluttered one with 30.`,
  sequence: `MERMAID RULES — readable, valid syntax:
- Use sequenceDiagram
- Show 2-3 key request/response flows (not every endpoint)
- Include participants: Client, API, key services, database
- Use arrows: ->> for requests, -->> for responses
- Add activation bars with activate/deactivate for clarity
- Include alt/opt/loop blocks where appropriate
- Keep the diagram focused — one clear flow per section`,
  class: `MERMAID RULES — readable, valid syntax:
- Use classDiagram
- Show 8-15 key classes (not every class in the repo)
- Include only the 2-3 most important methods/properties per class
- Use proper UML relationships: <|-- inheritance, *-- composition, o-- aggregation, --> association
- Include interfaces with <<interface>> stereotype
- Group related classes logically`,
  er: `MERMAID RULES — readable, valid syntax:
- Use erDiagram
- Show the core domain entities (8-15 max)
- Use proper cardinality: ||--o{ one-to-many, ||--|| one-to-one, }o--o{ many-to-many
- Include 2-4 key attributes per entity (PK, FK, important fields)
- Focus on the core domain model, skip internal/system tables`,
  component: `MERMAID RULES — readable, valid syntax:
- Use flowchart TD (not "graph")
- Show 8-15 key components/modules
- Use subgraphs to group related components. Nested subgraphs are allowed:
  subgraph Frontend
    subgraph Pages
      A["Dashboard"]
      B["Settings"]
    end
  end
- Add edge labels: "imports", "calls", "emits", "subscribes"
- Every subgraph MUST be closed with "end"
- Use simple node IDs (A, B, C, ..., Z, AA, AB). No spaces in IDs.
- Labels in quotes: A["ComponentName"]
- One statement per line.
- KEEP IT SIMPLE — clarity over completeness.`,
};

export function getSystemPrompt(diagramType: DiagramType = "architecture"): string {
  const diagramLabel = diagramType === "er" ? "ER" : diagramType.charAt(0).toUpperCase() + diagramType.slice(1);
  return `You are a software architect. Produce a brief summary AND a Mermaid ${diagramLabel} diagram for the repository.

You MUST output BOTH sections in this exact order:

## Summary
(2-4 sentences: what the repo does, purpose, main components, tech stack)

## Diagram
\`\`\`mermaid
(your diagram here)
\`\`\`

Do not skip the Summary section. Put it first, before the diagram.

${DIAGRAM_TYPE_INSTRUCTIONS[diagramType]}`;
}

export const SYSTEM_PROMPT = getSystemPrompt("architecture");

const USER_PROMPT_TEMPLATE = `{user_instructions_section}For this repository: {repo_name}

Output:
1. ## Summary — 2-4 sentences about what the repo does and its main components
2. ## Diagram — a detailed Mermaid diagram: include key files, subcomponents, subgraphs for layers (Frontend/Backend/etc), and edge labels showing relationships

Repository context:
{repo_context}
`;

/** Extract the summary from the response (before the mermaid block). */
export function extractSummary(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim().replace(/\\n/g, "\n");

  // Try "## Summary" ... "## Diagram" or "## Summary" ... ```mermaid
  const sectionMatch = trimmed.match(
    /(?:##\s*Summary|Summary)\s*:?\s*\n+([\s\S]*?)(?=\n##\s*Diagram|\n```mermaid|```mermaid|$)/i,
  );
  if (sectionMatch?.[1]) {
    const s = sectionMatch[1].trim();
    if (s.length > 20) return s;
  }

  // Fallback: text before the first ```mermaid block
  const mermaidIdx = trimmed.search(/```mermaid/i);
  if (mermaidIdx > 10) {
    const before = trimmed.slice(0, mermaidIdx).trim();
    // Remove leading ## or headers, get clean intro
    const cleaned = before.replace(/^#+\s*Summary\s*:?\s*\n?/i, "").trim();
    if (cleaned.length > 20) return cleaned;
  }

  return null;
}

/** Extract mermaid code from response (handles ```mermaid ... ``` or raw mermaid). */
export function extractMermaidCode(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();
  const match = trimmed.match(/```mermaid\s*\n?([\s\S]*?)```/i);
  if (match?.[1]) return match[1].trim();
  if (/^\s*(graph|flowchart|classDiagram|sequenceDiagram|stateDiagram|erDiagram)\s/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function buildUserPrompt(
  repo: RepoInfo,
  repoContext: string,
  userInstructions?: string | null,
): string {
  const repoName = `${repo.owner}/${repo.repoName}`;
  const trimmed = userInstructions?.trim();

  const userInstructionsSection = trimmed
    ? `USER REQUEST (answer this by tailoring the content inside sections 1–4 only; do NOT add a separate section or paragraph at the end for this):\n"${trimmed}"\n\n`
    : "";

  return USER_PROMPT_TEMPLATE.replace("{user_instructions_section}", userInstructionsSection)
    .replace("{repo_name}", repoName)
    .replace("{repo_context}", repoContext);
}

