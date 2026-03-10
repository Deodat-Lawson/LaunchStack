/**
 * Study Agent Chat Utilities
 * Helper functions for the study agent chat API
 */

import type { StudyPlanItem } from "./types";

/**
 * Summarize study plan progress for context
 */
export function summarizePlan(studyPlan?: StudyPlanItem[]): string {
  if (!studyPlan || studyPlan.length === 0) return "No study plan yet";
  const done = studyPlan.filter((i) => i.completed).length;
  return `${studyPlan.length} item(s)... ${done} completed`;
}

/**
 * Ensure text ends with trailing ellipses for TTS pacing
 */
export function ensureTrailingEllipses(text: string): string {
  const t = text.trimEnd();
  return t.endsWith("...") ? t : `${t}...`;
}

/**
 * Extract raw text content from LLM response
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : ""))
      .join("");
  }
  return "";
}

