/** @jest-environment node */

/**
 * Tests for extractTextAtCursor logic (cursor rewrite - extract sentence/paragraph at cursor).
 * The function is inlined in DocumentGeneratorEditor; this tests equivalent logic.
 */
function extractTextAtCursor(text: string, cursorPos: number): { text: string; start: number; end: number } {
  if (text.length === 0) return { text: "", start: 0, end: 0 };
  const len = text.length;
  let start = cursorPos;
  let end = cursorPos;
  while (start > 0) {
    const c = text[start - 1] ?? "";
    const prev = text[start - 2] ?? "";
    if (c === "\n" && start > 1 && prev === "\n") break;
    if ([".", "!", "?"].includes(c) && (start <= 1 || /[\s\n]/.test(prev))) break;
    start--;
  }
  while (end < len) {
    const c = text[end] ?? "";
    const next = text[end + 1] ?? "";
    if (c === "\n" && end + 1 < len && next === "\n") break;
    if ([".", "!", "?"].includes(c)) {
      end++;
      break;
    }
    end++;
  }
  const raw = text.slice(start, end);
  const trimmed = raw.trim();
  if (!trimmed) return { text: "", start: cursorPos, end: cursorPos };
  const leadSpace = raw.length - raw.trimStart().length;
  const trailSpace = raw.trimEnd().length;
  return { text: trimmed, start: start + leadSpace, end: start + trailSpace };
}

describe("extractTextAtCursor (cursor rewrite)", () => {
  it("extracts text from start to next sentence boundary when cursor in middle", () => {
    const text = "First sentence. Second sentence. Third.";
    const result = extractTextAtCursor(text, 18);
    expect(result.text.length).toBeGreaterThan(0);
    expect(text.slice(result.start, result.end).trim()).toBe(result.text);
  });

  it("extracts paragraph when cursor in middle (stops at double newline)", () => {
    const text = "One para.\n\nOther para.";
    const result = extractTextAtCursor(text, 5);
    expect(result.text).toBe("One para.");
  });

  it("returns empty and cursor pos when no extractable content", () => {
    const text = "";
    const result = extractTextAtCursor(text, 0);
    expect(result.text).toBe("");
    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
  });
});
