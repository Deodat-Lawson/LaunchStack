export type StatusStage =
  | "validating"
  | "fetching_tree"
  | "exploring_files"
  | "fetching_files"
  | "generating_explanation";

export interface RepoInfo {
  owner: string;
  repoName: string;
}

export type DiagramType =
  | "architecture"
  | "sequence"
  | "class"
  | "er"
  | "component";

export interface RepoExplanationRequest {
  /**
   * Full GitHub URL or "owner/repo".
   */
  url: string;
  /**
   * Optional user instructions to steer the explanation,
   * e.g. "Focus on API design" or "Generate a UML class diagram".
   */
  instructions?: string;
  /**
   * Type of diagram to generate. Determines which files are fetched
   * and how the LLM prompt is constructed. Defaults to "architecture".
   */
  diagramType?: DiagramType;
}

export interface RepoExplanationResult {
  explanation: string;
  repo: string;
  summary?: string | null;
  mermaidCode?: string | null;
  umlJson?: {
    format: "mermaid";
    repo: string;
    summary: string | null;
    diagram: string | null;
    generatedAt: string;
  };
  /**
   * ISO string timestamp when the explanation was generated.
   */
  timestamp: string;
}

export type StatusCallback = (stage: StatusStage) => void;

