/**
 * Metric helpers for the OCR benchmark harness.
 * Kept dependency-free so the harness can run without extra installs.
 */

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length]!;
}

/**
 * Normalized Levenshtein: 1 - (distance / max(len)). Higher = better. Range [0, 1].
 */
export function normalizedLevenshtein(pred: string, truth: string): number {
  const n = normalizeText(pred);
  const t = normalizeText(truth);
  if (n.length === 0 && t.length === 0) return 1;
  const maxLen = Math.max(n.length, t.length);
  return 1 - levenshteinDistance(n, t) / maxLen;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * F1 on table cells represented as `row|col|value` triples.
 * Input is a list of markdown tables; we parse each into pipe-split rows.
 */
export function tableCellF1(
  predTables: string[],
  truthTables: string[],
): { precision: number; recall: number; f1: number } {
  const pred = new Set(predTables.flatMap(tableToTriples));
  const truth = new Set(truthTables.flatMap(tableToTriples));

  if (truth.size === 0 && pred.size === 0) return { precision: 1, recall: 1, f1: 1 };
  if (truth.size === 0) return { precision: 0, recall: 0, f1: 0 };
  if (pred.size === 0) return { precision: 0, recall: 0, f1: 0 };

  let tp = 0;
  for (const triple of pred) if (truth.has(triple)) tp++;

  const precision = tp / pred.size;
  const recall = tp / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function tableToTriples(markdown: string): string[] {
  const rows = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"))
    .filter((l) => !/^\|?\s*[-:\s|]+\|?\s*$/.test(l));

  const triples: string[] = [];
  rows.forEach((row, r) => {
    const cells = row.slice(1, -1).split("|").map((c) => c.trim());
    cells.forEach((cell, c) => {
      if (cell.length > 0) triples.push(`${r}|${c}|${cell.toLowerCase()}`);
    });
  });
  return triples;
}

export function formatCoverage(pred: string): 0 | 1 {
  return normalizeText(pred).length >= 20 ? 1 : 0;
}
