"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import {
  ArrowLeft,
  Save,
  Download,
  FileText,
  Loader2,
  CheckCircle,
  Sparkles,
  Send,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Eye,
  EyeOff,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { EditorSection } from "~/lib/legal-templates/section-builders";
import type { TemplateField } from "~/lib/legal-templates/template-registry";
import {
  type FieldValidationError,
  buildTemplateFieldDataForDocx,
  extractFieldValuesFromSections,
  validateDocument,
} from "~/lib/legal-templates/legal-document-validation";
import { TEMPLATE_REGISTRY } from "~/lib/legal-templates/template-registry";

interface LegalDocumentEditorProps {
  initialTitle: string;
  sections: EditorSection[];
  /** Template id (e.g. nda) — required for DOCX export from current page */
  templateId: string;
  documentId?: number;
  templateFields: TemplateField[];
  onBack: () => void;
  onSave: (title: string, content: string, sections: EditorSection[]) => void;
}

function getFieldFormatHint(field: TemplateField): string {
  if (field.type === "date") return "Date";
  if (field.type === "number") {
    const k = field.key;
    if (k.endsWith("_pct") || k === "discount_rate") return "Number, 0–100%";
    if (
      k.endsWith("_months") ||
      k.endsWith("_years") ||
      k.endsWith("_days") ||
      k === "total_shares" ||
      k === "eligibility_age" ||
      k === "vacation_days"
    )
      return "Positive number";
    return "Number";
  }
  if (field.type === "select" && field.options)
    return field.options.join(" / ");
  if (field.type === "textarea") return "Free text";
  return "Text";
}

function buildFieldTooltip(field: TemplateField): string {
  const parts: string[] = [field.label, getFieldFormatHint(field)];
  if (field.required) parts.push("Required");
  return parts.join(" · ");
}

function extractFieldKeysFromHtml(html: string): string[] {
  const keys: string[] = [];
  const re = /data-field-key=(["'])([^"']+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) keys.push(m[2]);
  }
  return Array.from(new Set(keys));
}

/** First-seen order of field keys as they appear in the HTML (for restoring removed marks in place). */
function extractFieldKeysInDocumentOrder(html: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = /<mark[^>]*data-field-key=(["'])([^"']+)\1[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const k = m[2];
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

function insertMissingMarkAtOrderedPosition(
  el: HTMLElement,
  missingKey: string,
  orderedKeys: string[],
) {
  const mark = document.createElement("mark");
  mark.setAttribute("data-field-key", missingKey);
  mark.textContent = "\u200B";

  const idx = orderedKeys.indexOf(missingKey);
  if (idx < 0) {
    el.appendChild(mark);
    return;
  }

  for (let i = idx + 1; i < orderedKeys.length; i++) {
    const nextKey = orderedKeys[i];
    if (!nextKey) continue;
    let nextMark: Element | null = null;
    try {
      nextMark = el.querySelector(
        `mark[data-field-key="${CSS.escape(nextKey)}"]`,
      );
    } catch {
      nextMark = null;
    }
    if (nextMark?.parentNode) {
      nextMark.parentNode.insertBefore(mark, nextMark);
      return;
    }
  }

  for (let i = idx - 1; i >= 0; i--) {
    const prevKey = orderedKeys[i];
    if (!prevKey) continue;
    let prevMark: Element | null = null;
    try {
      prevMark = el.querySelector(
        `mark[data-field-key="${CSS.escape(prevKey)}"]`,
      );
    } catch {
      prevMark = null;
    }
    if (prevMark?.parentNode) {
      prevMark.parentNode.insertBefore(mark, prevMark.nextSibling);
      return;
    }
  }

  if (el.firstChild) {
    el.insertBefore(mark, el.firstChild);
  } else {
    el.appendChild(mark);
  }
}

/** Collapses repeated spaces in text nodes (edits can leave double spaces between marks). */
function collapseRunsOfSpacesInTextNodes(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) nodes.push(n as Text);
  }
  for (const textNode of nodes) {
    let t = textNode.textContent ?? "";
    const next = t.replace(/ {2,}/g, " ");
    if (next !== t) textNode.textContent = next;
  }
}

function syncLegalMarkEmptyClass(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>("mark[data-field-key]").forEach((mark) => {
    const text = (mark.textContent ?? "").replace(/\u200B/g, "").trim();
    if (text === "") {
      mark.classList.add("legal-mark-empty");
    } else {
      mark.classList.remove("legal-mark-empty");
    }
  });
}

function extractAllFieldKeysFromSections(
  sectionList: EditorSection[],
): string[] {
  const keys = new Set<string>();
  for (const s of sectionList) {
    for (const k of extractFieldKeysFromHtml(s.content)) keys.add(k);
  }
  return Array.from(keys);
}

function findParentMarkInElement(el: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== el) {
    if (
      current instanceof HTMLElement &&
      current.tagName === "MARK" &&
      current.hasAttribute("data-field-key")
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function placeCaretInsideMark(mark: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(mark);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * After deleting the last character, the browser often moves the caret outside the
 * <mark>, while beforeinput only allows typing inside a mark — so typing appears "stuck".
 */
function ensureCaretInsideMarkAfterRepair(
  el: HTMLElement,
  preferredFieldKey: string | null,
) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchor = sel.anchorNode;
  if (!anchor || !el.contains(anchor)) return;
  if (findParentMarkInElement(el, anchor)) return;

  let target: HTMLElement | null = null;
  if (preferredFieldKey) {
    try {
      target = el.querySelector(
        `mark[data-field-key="${CSS.escape(preferredFieldKey)}"]`,
      );
    } catch {
      target = null;
    }
  }
  if (!target) {
    for (const m of el.querySelectorAll<HTMLElement>("mark[data-field-key]")) {
      const t = (m.textContent ?? "").replace(/\u200B/g, "").trim();
      if (t === "") {
        target = m;
        break;
      }
    }
  }
  if (!target) {
    target = el.querySelector("mark[data-field-key]");
  }
  if (target) placeCaretInsideMark(target);
}

/**
 * Stops the browser from removing or unwrapping the <mark> when the last visible
 * character is deleted — the highlight stays in the original sentence position.
 */
function interceptDeleteThatEmptiesMark(
  e: InputEvent,
  mark: HTMLElement,
  range: Range,
  onSync: () => void,
): boolean {
  const it = e.inputType;
  if (it !== "deleteContentBackward" && it !== "deleteContentForward") {
    return false;
  }
  const text = mark.textContent ?? "";
  const visible = text.replace(/\u200B/g, "");
  if (visible.length === 0) {
    e.preventDefault();
    mark.textContent = "\u200B";
    placeCaretInsideMark(mark);
    onSync();
    return true;
  }
  if (!range.collapsed) return false;
  if (visible.length !== 1) return false;

  const sc = range.startContainer;
  if (sc.nodeType !== Node.TEXT_NODE || !mark.contains(sc)) return false;
  const tn = sc.textContent ?? "";
  const off = range.startOffset;
  const onlyChar = visible[0]!;

  if (it === "deleteContentBackward") {
    if (off <= 0) return false;
    const before = tn.slice(0, off).replace(/\u200B/g, "");
    if (before.length === 1 && before[0] === onlyChar) {
      e.preventDefault();
      mark.textContent = "\u200B";
      placeCaretInsideMark(mark);
      onSync();
      return true;
    }
    return false;
  }

  if (off >= tn.length) return false;
  if (tn[off] === "\u200B") return false;
  const fromOff = tn.slice(off).replace(/\u200B/g, "");
  if (fromOff.length >= 1 && fromOff[0] === onlyChar) {
    e.preventDefault();
    mark.textContent = "\u200B";
    placeCaretInsideMark(mark);
    onSync();
    return true;
  }
  return false;
}

/**
 * When the caret sits in static "glue" text (between marks, after <strong>, etc.),
 * insertText targets that text node — characters become uneditable. Route typing into
 * the nearest field mark instead.
 */
function findTargetMarkForStrayInsertion(
  el: HTMLElement,
  range: Range,
  preferredKey: string | null,
): HTMLElement | null {
  if (preferredKey) {
    try {
      const m = el.querySelector(
        `mark[data-field-key="${CSS.escape(preferredKey)}"]`,
      ) as HTMLElement | null;
      if (m) return m;
    } catch {
      /* ignore */
    }
  }

  const node = range.startContainer;
  const offset = range.startOffset;

  const markFromElement = (n: HTMLElement): HTMLElement | null => {
    if (n.tagName === "MARK" && n.hasAttribute("data-field-key")) return n;
    return n.querySelector("mark[data-field-key]") as HTMLElement | null;
  };

  if (node.nodeType === Node.TEXT_NODE) {
    const tn = node.textContent ?? "";
    if (offset === 0) {
      let prev: Node | null = node.previousSibling;
      while (prev) {
        if (prev.nodeType === Node.ELEMENT_NODE) {
          const hit = markFromElement(prev as HTMLElement);
          if (hit) return hit;
        }
        prev = prev.previousSibling;
      }
      let next: Node | null = node.nextSibling;
      while (next) {
        if (next.nodeType === Node.ELEMENT_NODE) {
          const hit = markFromElement(next as HTMLElement);
          if (hit) return hit;
        }
        next = next.nextSibling;
      }
    }
    if (offset === tn.length) {
      let next: Node | null = node.nextSibling;
      while (next) {
        if (next.nodeType === Node.ELEMENT_NODE) {
          const hit = markFromElement(next as HTMLElement);
          if (hit) return hit;
        }
        next = next.nextSibling;
      }
      let prev: Node | null = node.previousSibling;
      while (prev) {
        if (prev.nodeType === Node.ELEMENT_NODE) {
          const hit = markFromElement(prev as HTMLElement);
          if (hit) return hit;
        }
        prev = prev.previousSibling;
      }
    }
  }

  if (node === el && typeof offset === "number") {
    if (offset > 0) {
      const before = el.childNodes[offset - 1];
      if (before instanceof HTMLElement) {
        const hit = markFromElement(before);
        if (hit) return hit;
      }
    }
    if (offset < el.childNodes.length) {
      const after = el.childNodes[offset];
      if (after instanceof HTMLElement) {
        const hit = markFromElement(after);
        if (hit) return hit;
      }
    }
  }

  const marks = el.querySelectorAll<HTMLElement>("mark[data-field-key]");
  if (marks.length === 0) return null;
  if (marks.length === 1) return marks[0] ?? null;

  let cr: DOMRect;
  try {
    cr = range.getBoundingClientRect();
  } catch {
    return marks[0] ?? null;
  }
  const cx = cr.left + cr.width / 2;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const m of marks) {
    const r = m.getBoundingClientRect();
    const mx = r.left + r.width / 2;
    const d = Math.abs(mx - cx);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

function interceptStrayTextInsertion(
  e: InputEvent,
  el: HTMLElement,
  range: Range,
  preferredFieldKey: string | null,
  onSync: () => void,
): boolean {
  const it = e.inputType;
  if (it !== "insertText" && it !== "insertReplacementText") {
    return false;
  }
  const data = typeof e.data === "string" ? e.data : "";
  if (data.length === 0) return false;
  if (!range.collapsed) return false;

  const startMark = findParentMarkInElement(el, range.startContainer);
  const endMark = findParentMarkInElement(el, range.endContainer);
  if (startMark && endMark && startMark === endMark) {
    return false;
  }

  if (!el.contains(range.startContainer)) return false;

  const target = findTargetMarkForStrayInsertion(
    el,
    range,
    preferredFieldKey,
  );
  if (!target) return false;

  e.preventDefault();
  placeCaretInsideMark(target);
  document.execCommand("insertText", false, data);
  onSync();
  return true;
}

/**
 * After clearing a field, the mark often only holds ZWSP. Browsers still report the
 * caret as "inside" the mark, so interceptStrayTextInsertion bails out — but the
 * default insertText then lands in adjacent glue text. Force the typed text into
 * the last-focused mark while it is still empty.
 */
function interceptInsertIntoLastFocusedEmptyMark(
  e: InputEvent,
  el: HTMLElement,
  range: Range,
  preferredKey: string | null,
  onSync: () => void,
): boolean {
  if (e.inputType !== "insertText" && e.inputType !== "insertReplacementText") {
    return false;
  }
  const data = typeof e.data === "string" ? e.data : "";
  if (!data || !range.collapsed) return false;
  if (!preferredKey) return false;

  let mark: HTMLElement | null = null;
  try {
    mark = el.querySelector(
      `mark[data-field-key="${CSS.escape(preferredKey)}"]`,
    ) as HTMLElement | null;
  } catch {
    return false;
  }
  if (!mark || !el.contains(mark)) return false;

  const visible = (mark.textContent ?? "").replace(/\u200B/g, "").trim();
  if (visible.length > 0) return false;

  e.preventDefault();
  mark.textContent = data;
  placeCaretInsideMark(mark);
  onSync();
  return true;
}

function getSectionFieldLabels(
  html: string,
  fieldMap: Record<string, TemplateField>,
): string[] {
  return extractFieldKeysFromHtml(html)
    .map((key) => fieldMap[key]?.label ?? key)
    .filter(Boolean);
}

function formatFieldLabelList(labels: string[], maxVisible = 3): string {
  if (labels.length === 0) return "";
  if (labels.length <= maxVisible) return labels.join(", ");
  return `${labels.slice(0, maxVisible).join(", ")} +${labels.length - maxVisible} more`;
}

function normalizeAiJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

function parseFieldUpdateResponse(text: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(normalizeAiJson(text)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const entries = Object.entries(parsed).map(([key, value]) => {
      const str =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : "";
      return [key, str] as [string, string];
    });

    return Object.fromEntries(entries.filter(([, v]) => v.length > 0));
  } catch {
    return null;
  }
}

function resolveCanonicalFieldKey(
  rawKey: string,
  validKeys: Set<string>,
): string | null {
  const t = rawKey.trim();
  if (!t) return null;
  if (validKeys.has(t)) return t;
  const lower = t.toLowerCase();
  for (const k of validKeys) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

function resolveFieldKeyFromAi(
  rawKey: string,
  validKeys: Set<string>,
  fieldMap: Record<string, TemplateField>,
): string | null {
  const byKey = resolveCanonicalFieldKey(rawKey, validKeys);
  if (byKey) return byKey;
  const t = rawKey.trim().toLowerCase();
  if (!t) return null;
  for (const key of validKeys) {
    const field = fieldMap[key];
    if (field && field.label.toLowerCase() === t) return key;
  }
  return null;
}

function applyFieldUpdatesToHtml(
  html: string,
  updates: Record<string, string>,
): string {
  let nextHtml = html;

  for (const [key, value] of Object.entries(updates)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `(<mark[^>]*data-field-key=["']${escaped}["'][^>]*>)[\\s\\S]*?(</mark>)`,
      "gi",
    );
    nextHtml = nextHtml.replace(
      regex,
      (_match: string, openTag: string, closeTag: string) =>
        `${openTag}${value}${closeTag}`,
    );
  }

  return nextHtml;
}

function EditableSection({
  section,
  isActive,
  onFocus,
  onUpdate,
  onFieldBlur,
  onFieldFocus,
  showHighlights,
  invalidFields,
  showErrors,
  fieldMap,
  sectionFieldLabels,
}: {
  section: EditorSection;
  isActive: boolean;
  onFocus: (id: string) => void;
  onUpdate: (id: string, html: string) => void;
  onFieldBlur: (key: string, value: string) => void;
  onFieldFocus: (key: string) => void;
  showHighlights: boolean;
  invalidFields: Set<string>;
  showErrors: boolean;
  fieldMap: Record<string, TemplateField>;
  sectionFieldLabels: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInternalEdit = useRef(false);
  const lastSetContent = useRef(section.content);
  /**
   * Field keys in original document order (plus any keys merged in later). Used so
   * restored <mark>s insert next to their neighbors instead of at the end of the paragraph.
   */
  const expectedFieldKeysOrderedRef = useRef<string[]>([]);
  /** Last field the user placed the caret in — survives one-char delete when the caret jumps outside the mark. */
  const lastFocusedFieldKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const keys = extractFieldKeysInDocumentOrder(section.content);
    const prev = expectedFieldKeysOrderedRef.current;
    if (prev.length === 0) {
      expectedFieldKeysOrderedRef.current = keys;
    } else {
      const seen = new Set(prev);
      for (const k of keys) {
        if (!seen.has(k)) {
          seen.add(k);
          expectedFieldKeysOrderedRef.current.push(k);
        }
      }
    }
  }, [section.content]);

  const repairFieldMarksInDom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>("mark[data-field-key]").forEach((mark) => {
      const text = (mark.textContent ?? "").replace(/\u200B/g, "").trim();
      if (text === "") {
        mark.textContent = "\u200B";
      }
    });
    const present = new Set(extractFieldKeysFromHtml(el.innerHTML));
    const ordered = expectedFieldKeysOrderedRef.current;
    for (const key of ordered) {
      if (!present.has(key)) {
        insertMissingMarkAtOrderedPosition(el, key, ordered);
        present.add(key);
      }
    }
    collapseRunsOfSpacesInTextNodes(el);
    syncLegalMarkEmptyClass(el);
  }, []);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    isInternalEdit.current = true;
    const sel = window.getSelection();
    let preferredKey: string | null = null;
    if (sel?.anchorNode && el.contains(sel.anchorNode)) {
      const m = findParentMarkInElement(el, sel.anchorNode);
      preferredKey = m?.getAttribute("data-field-key") ?? null;
    }
    if (!preferredKey) preferredKey = lastFocusedFieldKeyRef.current;

    repairFieldMarksInDom();
    ensureCaretInsideMarkAfterRepair(el, preferredKey);
    const selAfter = window.getSelection();
    if (selAfter?.anchorNode && el.contains(selAfter.anchorNode)) {
      const mAfter = findParentMarkInElement(el, selAfter.anchorNode);
      const nk = mAfter?.getAttribute("data-field-key");
      if (nk) lastFocusedFieldKeyRef.current = nk;
    }

    lastSetContent.current = el.innerHTML;
    onUpdate(section.id, el.innerHTML);
  }, [section.id, onUpdate, repairFieldMarksInDom]);

  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;

  useLayoutEffect(() => {
    const currentDomContent = ref.current?.innerHTML ?? "";

    if (isInternalEdit.current) {
      isInternalEdit.current = false;
      if (
        section.content === lastSetContent.current ||
        section.content === currentDomContent
      ) {
        lastSetContent.current = section.content;
        return;
      }
    }

    if (section.content !== currentDomContent) {
      if (ref.current) ref.current.innerHTML = section.content;
      lastSetContent.current = section.content;
    }
  }, [section.content]);

  useEffect(() => {
    const el = ref.current;
    if (!el || section.type !== "paragraph") return;

    const handleBeforeInput = (e: InputEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        e.preventDefault();
        return;
      }
      const range = sel.getRangeAt(0);
      const startMark = findParentMarkInElement(el, range.startContainer);
      const endMark = findParentMarkInElement(el, range.endContainer);

      if (
        startMark &&
        endMark &&
        startMark === endMark &&
        interceptDeleteThatEmptiesMark(e, startMark, range, () => {
          handleInputRef.current();
        })
      ) {
        return;
      }

      if (
        interceptInsertIntoLastFocusedEmptyMark(
          e,
          el,
          range,
          lastFocusedFieldKeyRef.current,
          () => {
            handleInputRef.current();
          },
        )
      ) {
        return;
      }

      if (
        interceptStrayTextInsertion(e, el, range, lastFocusedFieldKeyRef.current, () => {
          handleInputRef.current();
        })
      ) {
        return;
      }

      if (!startMark || !endMark || startMark !== endMark) {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        const sel = window.getSelection();
        if (!sel || !sel.anchorNode) return;
        const mark = findParentMarkInElement(el, sel.anchorNode);
        if (mark) {
          e.preventDefault();
          const range = document.createRange();
          range.selectNodeContents(mark);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!findParentMarkInElement(el, sel.getRangeAt(0).startContainer))
        return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) document.execCommand("insertText", false, text);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const mark = findParentMarkInElement(el, target);
      if (!mark) return;
      e.preventDefault();
      el.focus();
      const key = mark.getAttribute("data-field-key");
      if (key) lastFocusedFieldKeyRef.current = key;
      placeCaretInsideMark(mark);
      onFieldFocus(key!);
      onFocus(section.id);
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.tagName === "MARK" &&
        target.hasAttribute("data-field-key")
      ) {
        const k = target.getAttribute("data-field-key");
        if (k) lastFocusedFieldKeyRef.current = k;
        onFieldFocus(k!);
      }
      onFocus(section.id);
    };

    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.tagName === "MARK" &&
        target.hasAttribute("data-field-key")
      ) {
        onFieldBlur(
          target.getAttribute("data-field-key")!,
          target.innerHTML,
        );
      }
    };

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel?.anchorNode || !el.contains(sel.anchorNode)) return;
      const mark = findParentMarkInElement(el, sel.anchorNode);
      const k = mark?.getAttribute("data-field-key");
      if (k) lastFocusedFieldKeyRef.current = k;
    };

    el.addEventListener("beforeinput", handleBeforeInput);
    el.addEventListener("keydown", handleKeyDown);
    el.addEventListener("paste", handlePaste);
    el.addEventListener("drop", handleDrop);
    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("focusin", handleFocusIn);
    el.addEventListener("focusout", handleFocusOut);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      el.removeEventListener("beforeinput", handleBeforeInput);
      el.removeEventListener("keydown", handleKeyDown);
      el.removeEventListener("paste", handlePaste);
      el.removeEventListener("drop", handleDrop);
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("focusin", handleFocusIn);
      el.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [section.type, section.id, onFocus, onFieldBlur, onFieldFocus]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const marks = el.querySelectorAll("mark[data-field-key]");
    marks.forEach((mark) => {
      const key = mark.getAttribute("data-field-key");
      if (!key) return;
      const field = fieldMap[key];
      if (field) {
        mark.setAttribute("title", buildFieldTooltip(field));
      }
      if (showErrors && invalidFields.has(key)) {
        mark.classList.add("field-invalid");
      } else {
        mark.classList.remove("field-invalid");
      }
    });
    syncLegalMarkEmptyClass(el);
  }, [invalidFields, showErrors, section.content, fieldMap]);

  if (section.type === "title") {
    return (
      <div className="text-center py-8 pb-4 border-b-2 border-[#1a1a2e] mb-6">
        <h1
          className="text-2xl font-bold tracking-wide text-[#1a1a2e] dark:text-foreground m-0"
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            letterSpacing: "0.06em",
          }}
        >
          {section.content}
        </h1>
      </div>
    );
  }

  if (section.type === "heading") {
    return (
      <h2
        className="text-base font-bold text-[#1a1a2e] dark:text-foreground mt-6 mb-1.5 pb-1 border-b border-[#e0d8cf] dark:border-border tracking-wide"
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          letterSpacing: "0.02em",
        }}
      >
        {section.content}
      </h2>
    );
  }

  return (
    <div
      className={cn(
        "relative my-1 rounded transition-all",
        isActive
          ? "border border-[#8B7355] bg-[rgba(139,115,85,0.03)] dark:bg-[rgba(139,115,85,0.08)]"
          : "border border-transparent",
      )}
    >
      {isActive && sectionFieldLabels.length > 0 && (
        <div className="absolute -top-2.5 left-3 max-w-[calc(100%-24px)] bg-[#f9f6f1] dark:bg-card px-1.5 text-[10px] font-semibold text-[#8B7355] tracking-wide truncate">
          {formatFieldLabelList(sectionFieldLabels)}
        </div>
      )}
      <div
        ref={ref}
        data-legal-section-id={section.id}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className={cn(
          "text-sm leading-7 text-[#2c2c2c] dark:text-foreground px-3 py-2 outline-none min-h-[20px]",
          "cursor-default select-text",
          "[&_mark[data-field-key]]:cursor-text [&_mark[data-field-key]]:outline-none [&_mark[data-field-key]]:rounded",
          "[&_mark[data-field-key]]:py-[1px] [&_mark[data-field-key]]:px-1",
          // Empty fields (ZWSP-only): full px-1 on each adjacent mark looks like extra gaps in a sentence.
          "[&_mark[data-field-key].legal-mark-empty]:!px-0.5 [&_mark[data-field-key].legal-mark-empty]:inline-block [&_mark[data-field-key].legal-mark-empty]:min-w-[3px]",
          "[&_mark[data-field-key]]:transition-all [&_mark[data-field-key]]:duration-150",
          "[&_mark:focus]:ring-2 [&_mark:focus]:ring-blue-400/50 [&_mark:focus]:bg-blue-50 dark:[&_mark:focus]:bg-blue-900/30",
          "[&_.field-invalid]:!bg-red-50 [&_.field-invalid]:!border-b-2 [&_.field-invalid]:!border-red-400 dark:[&_.field-invalid]:!bg-red-900/20 dark:[&_.field-invalid]:!border-red-500",
          showHighlights
            ? "[&_mark]:bg-amber-100/80 [&_mark]:border-b-2 [&_mark]:border-amber-300 dark:[&_mark]:bg-amber-900/30 dark:[&_mark]:border-amber-600"
            : "[&_mark]:bg-slate-100 [&_mark]:border-b [&_mark]:border-dashed [&_mark]:border-slate-300 dark:[&_mark]:bg-slate-800/30 dark:[&_mark]:border-slate-600",
          "[&_mark:hover]:bg-blue-50 [&_mark:hover]:border-blue-300 dark:[&_mark:hover]:bg-blue-900/20 dark:[&_mark:hover]:border-blue-500",
        )}
        style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
      />
    </div>
  );
}

export function LegalDocumentEditor({
  initialTitle,
  sections: initialSections,
  templateId,
  documentId,
  templateFields,
  onBack,
  onSave,
}: LegalDocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [sections, setSections] = useState<EditorSection[]>(initialSections);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [editCount, setEditCount] = useState(0);
  const [status, setStatus] = useState<"draft" | "editing" | "saved">("draft");
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [isApplyingEdits, setIsApplyingEdits] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  const [validationErrors, setValidationErrors] = useState<
    FieldValidationError[]
  >([]);
  const [showValidationDetails, setShowValidationDetails] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [focusedFieldKey, setFocusedFieldKey] = useState<string | null>(null);

  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fieldMap = useMemo(() => {
    const map: Record<string, TemplateField> = {};
    for (const f of templateFields) map[f.key] = f;
    return map;
  }, [templateFields]);

  const invalidFieldKeys = useMemo(
    () => new Set(validationErrors.map((e) => e.key)),
    [validationErrors],
  );

  const sectionFieldLabelsById = useMemo(() => {
    const entries = sections.map((section) => [
      section.id,
      getSectionFieldLabels(section.content, fieldMap),
    ]);
    return Object.fromEntries(entries) as Record<string, string[]>;
  }, [sections, fieldMap]);

  const focusedField = focusedFieldKey ? (fieldMap[focusedFieldKey] ?? null) : null;
  const focusedFieldError = focusedFieldKey
    ? validationErrors.find((e) => e.key === focusedFieldKey)
    : null;
  const activeSectionFieldLabels = activeSection
    ? (sectionFieldLabelsById[activeSection] ?? [])
    : [];

  const runValidation = useCallback(() => {
    const fieldValues = extractFieldValuesFromSections(
      sections.map((s) => s.content),
    );
    const result = validateDocument(fieldValues, templateFields);
    setValidationErrors(result.errors);
    return result;
  }, [sections, templateFields]);

  const debouncedValidation = useCallback(() => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      runValidation();
    }, 400);
  }, [runValidation]);

  useEffect(() => {
    runValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdate = useCallback(
    (id: string, html: string) => {
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, content: html } : s)),
      );
      setStatus("editing");
      setEditCount((c) => c + 1);
      debouncedValidation();
    },
    [debouncedValidation],
  );

  const handleFieldSync = useCallback((key: string, value: string) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `(<mark[^>]*data-field-key=["']${escaped}["'][^>]*>)[\\s\\S]*?(</mark>)`,
      "gi",
    );
    setSections((prev) =>
      prev.map((s) => {
        const newContent = s.content.replace(
          regex,
          (_match: string, openTag: string, closeTag: string) =>
            `${openTag}${value}${closeTag}`,
        );
        return newContent !== s.content ? { ...s, content: newContent } : s;
      }),
    );
  }, []);

  const applyFieldUpdates = useCallback((updates: Record<string, string>) => {
    const prev = sectionsRef.current;
    const next = prev.map((section) => {
      const nextContent = applyFieldUpdatesToHtml(section.content, updates);
      return nextContent !== section.content
        ? { ...section, content: nextContent }
        : section;
    });
    const changed = next.some(
      (s, i) => s.content !== prev[i]?.content,
    );
    if (changed) {
      setSections(next);
    }
    return changed;
  }, []);

  const handleFormat = (cmd: string) => {
    if (cmd === "highlight") {
      document.execCommand("hiliteColor", false, "#FFF59D");
    } else if (cmd === "removeHighlight") {
      document.execCommand("hiliteColor", false, "transparent");
    } else {
      document.execCommand(cmd, false, undefined);
    }
  };

  /**
   * Paragraph HTML from live DOM — React `sections` can lag behind contentEditable
   * (e.g. last keystroke before Save / DOCX). Use this for save + Word export.
   */
  const getLiveExportSnapshot = useCallback((): {
    html: string;
    sections: EditorSection[];
  } => {
    const root = document.getElementById("legal-document-export-root");
    const nextSections = sections.map((s) => {
      if (s.type !== "paragraph") return s;
      const safe = s.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = root?.querySelector(`[data-legal-section-id="${safe}"]`);
      const inner =
        el instanceof HTMLElement ? el.innerHTML : s.content;
      return { ...s, content: inner };
    });
    const html = nextSections
      .map((s) => {
        if (s.type === "title") return `<h1>${s.content}</h1>`;
        if (s.type === "heading") return `<h2>${s.content}</h2>`;
        return `<p>${s.content}</p>`;
      })
      .join("\n");
    return { html, sections: nextSections };
  }, [sections]);

  const handleSave = useCallback(async () => {
    setSaveAttempted(true);
    const snapshot = getLiveExportSnapshot();
    const fieldValues = extractFieldValuesFromSections(
      snapshot.sections.map((s) => s.content),
    );
    const result = validateDocument(fieldValues, templateFields);
    setValidationErrors(result.errors);
    if (!result.valid) {
      setShowValidationDetails(true);
      return;
    }
    setIsSaving(true);
    try {
      await Promise.resolve(
        onSave(title, snapshot.html, snapshot.sections),
      );
      setSections(snapshot.sections);
      setLastSaved(new Date());
      setStatus("saved");
      setSaveAttempted(false);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, title, getLiveExportSnapshot, templateFields]);

  const downloadDocx = async () => {
    if (!templateId || !TEMPLATE_REGISTRY[templateId]) {
      toast.error("Template not configured", {
        description: "Unable to export document.",
      });
      return;
    }
    
    setIsDownloadingDocx(true);
    const loadingToast = toast.loading("Generating DOCX...");

    try {
      const { html } = getLiveExportSnapshot();
      const data = buildTemplateFieldDataForDocx(templateId, html);
      const res = await fetch("/api/document-generator/legal-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          data,
          format: "json",
        }),
      });

      if (!res.ok) {
        throw new Error(`Export failed: HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        success?: boolean;
        docxBase64?: string;
        error?: string;
      };

      if (!json.success || !json.docxBase64) {
        throw new Error(json.error || "Failed to generate DOCX");
      }

      const byteChars = atob(json.docxBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++)
        byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "document"}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success("Document downloaded!", {
        description: `${title || "Document"}.docx`,
        id: loadingToast,
      });
      setStatus("saved");
    } catch (error) {
      console.error("DOCX export error:", error);
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Could not generate DOCX file",
        id: loadingToast,
        duration: 5000,
      });
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  const exportPdf = () => {
    window.print();
  };

  const applyEditsWithTrackChanges = async () => {
    if (!templateId || !TEMPLATE_REGISTRY[templateId]) {
      toast.error("Template not configured", {
        description: "Unable to generate document. Please contact support.",
      });
      return;
    }

    // Validate document before applying track changes
    const validation = runValidation();
    if (!validation.valid) {
      toast.error("Document has validation errors", {
        description: `Please fix ${validation.errors.length} field error${validation.errors.length > 1 ? "s" : ""} before applying track changes.`,
      });
      setShowValidationDetails(true);
      setSaveAttempted(true);
      return;
    }

    setIsApplyingEdits(true);
    
    // Show loading toast
    const loadingToast = toast.loading("Generating document with track changes...", {
      description: "This may take a few moments",
    });

    try {
      const { html } = getLiveExportSnapshot();
      const fieldValues = extractFieldValuesFromSections([html]);

      const template = TEMPLATE_REGISTRY[templateId];
      if (!template) throw new Error("Template not found");

      // Use unique tokens per field so Adeu can match each occurrence unambiguously.
      // Format: __FLD_<idx>_<key>__   (guaranteed unique, never appears in real text)
      const placeholderData: Record<string, string> = {};
      const tokenMap: Record<string, string> = {};
      template.fields.forEach((f, idx) => {
        if (f.type === "select" && f.options?.length) {
          placeholderData[f.key] = f.options[0]!;
        } else {
          const token = `__FLD_${idx}_${f.key}__`;
          placeholderData[f.key] = token;
          tokenMap[f.key] = token;
        }
      });

      toast.loading("Step 1: Generating base document...", {
        description: "Creating DOCX template with placeholders",
        id: loadingToast,
      });

      const res = await fetch("/api/document-generator/legal-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          data: placeholderData,
          format: "json",
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(errBody?.error || `Document generation failed: HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        success?: boolean;
        docxBase64?: string;
        error?: string;
      };

      if (!json.success || !json.docxBase64) {
        throw new Error(json.error || "Failed to generate DOCX");
      }

      // Build edits: each targets the unique token and replaces with the real value.
      const edits: Array<{ target_text: string; new_text: string; comment?: string }> = [];
      for (const [key, value] of Object.entries(fieldValues)) {
        const cleanValue = value.replace(/<[^>]*>/g, "").replace(/\u200B/g, "").trim();
        if (!cleanValue || cleanValue.startsWith("[")) continue;

        const field = fieldMap[key];
        const placeholder = tokenMap[key] ?? placeholderData[key];
        if (!placeholder || cleanValue === placeholder) continue;

        edits.push({
          target_text: placeholder,
          new_text: cleanValue,
          comment: field ? `Updated ${field.label}` : undefined,
        });
      }

      if (edits.length === 0) {
        toast.warning("No edits to apply", {
          description: "All fields are using default placeholders",
          id: loadingToast,
        });
        setIsApplyingEdits(false);
        return;
      }

      toast.loading(`Step 2: Applying ${edits.length} edit${edits.length > 1 ? "s" : ""} as track changes...`, {
        description: "Processing with Adeu service",
        id: loadingToast,
      });

      const applyRes = await fetch("/api/legal/apply-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentBase64: json.docxBase64,
          authorName: "Legal Document Editor",
          edits,
        }),
      });

      const applyJson = (await applyRes.json()) as {
        success?: boolean;
        modifiedDocxBase64?: string;
        summary?: {
          applied_edits: number;
          skipped_edits: number;
        };
        error?: string;
        message?: string;
      };

      if (!applyRes.ok || !applyJson.success || !applyJson.modifiedDocxBase64) {
        const err = new Error(applyJson.message || applyJson.error || "Failed to apply edits");
        (err as Error & { serverError?: string }).serverError = applyJson.error;
        throw err;
      }

      // Step 4: Download the modified DOCX with Track Changes
      const byteChars = atob(applyJson.modifiedDocxBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++)
        byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "document"}-tracked.docx`;
      a.click();
      URL.revokeObjectURL(url);
      
      // Success notification with details
      const { applied_edits = 0, skipped_edits = 0 } = applyJson.summary || {};
      toast.success("Document ready with track changes!", {
        description: `${applied_edits} edit${applied_edits > 1 ? "s" : ""} applied${skipped_edits > 0 ? `, ${skipped_edits} skipped` : ""}. Download started.`,
        id: loadingToast,
        duration: 5000,
      });
      
      setStatus("saved");
    } catch (error) {
      console.error("Track changes error:", error);
      
      const serverError = (error as Error & { serverError?: string }).serverError ?? "";
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";

      let errorMessage = "Failed to apply track changes";
      let errorDescription = errMsg;

      if (serverError.includes("not configured") || errMsg.includes("not configured") || errMsg.includes("ADEU_SERVICE_URL")) {
        errorMessage = "Track Changes not configured";
        errorDescription = "The redlining service (Adeu) is not set up. Ask your admin to configure ADEU_SERVICE_URL.";
      } else if (
        errMsg.includes("ECONNREFUSED") || errMsg.includes("ENOTFOUND") ||
        errMsg.includes("fetch failed") || errMsg.includes("Failed to fetch")
      ) {
        errorMessage = "Redlining service unreachable";
        errorDescription = "The Adeu service is not running. Start it with Docker Compose or check ADEU_SERVICE_URL in your .env.";
      } else if (errMsg.includes("Batch rejected") || errMsg.includes("Ambiguous match")) {
        errorMessage = "Track Changes failed";
        errorDescription = "Some field edits could not be applied. The document may have duplicate field references.";
      }

      toast.error(errorMessage, {
        description: errorDescription,
        id: loadingToast,
        duration: 7000,
      });
    } finally {
      setIsApplyingEdits(false);
    }
  };

  const getSelectedSectionContent = (): string => {
    if (!activeSection) return "";
    const section = sections.find((s) => s.id === activeSection);
    return section?.content ?? "";
  };

  const handleAIRequest = async () => {
    if (!aiPrompt.trim()) return;
    if (!activeSection) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Select a section with highlighted fields first.",
        },
      ]);
      return;
    }

    setIsProcessing(true);
    setChatMessages((prev) => [...prev, { role: "user", content: aiPrompt }]);
    const prompt = aiPrompt;
    setAiPrompt("");

    const sectionContent = getSelectedSectionContent();
    const sectionFieldKeys = extractFieldKeysFromHtml(sectionContent);
    const sectionFields = sectionFieldKeys
      .map((key) => fieldMap[key])
      .filter((field): field is TemplateField => Boolean(field));

    if (sectionFields.length === 0) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "This section does not contain editable highlighted fields.",
        },
      ]);
      setIsProcessing(false);
      return;
    }

    const fieldValues = extractFieldValuesFromSections(
      sections.map((s) => s.content),
    );
    const focusedSectionField =
      focusedFieldKey && sectionFieldKeys.includes(focusedFieldKey)
        ? fieldMap[focusedFieldKey]
        : null;
    const fieldContext = sectionFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options ?? [],
      currentValue: fieldValues[field.key] ?? "",
    }));

    try {
      const response = await fetch("/api/document-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "field_update",
          content: JSON.stringify(fieldContext, null, 2),
          prompt: [
            "Update only the editable field values requested by the user.",
            "Do not rewrite or alter any non-highlighted document text.",
            focusedSectionField
              ? `The user is currently focused on: ${focusedSectionField.label} (${focusedSectionField.key}).`
              : null,
            `User request: ${prompt}`,
            "Return ONLY a JSON object where each key is a field key and each value is the new field value.",
            "If no field should change, return {}.",
          ]
            .filter(Boolean)
            .join("\n"),
          context: {
            documentTitle: title,
            fullContent: sectionContent,
          },
          options: { tone: "professional", length: "brief" },
        }),
      });

      const data = (await response.json()) as {
        success: boolean;
        generatedContent?: string;
      };

      if (data.success && data.generatedContent) {
        const parsedUpdates = parseFieldUpdateResponse(data.generatedContent);

        if (!parsedUpdates) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "The AI response could not be applied. Please name the exact highlighted field you want changed.",
            },
          ]);
          return;
        }

        const validKeys = new Set<string>();
        for (const k of extractAllFieldKeysFromSections(sectionsRef.current)) {
          validKeys.add(k);
        }
        for (const f of templateFields) {
          validKeys.add(f.key);
        }

        const allowedUpdates: Record<string, string> = {};
        for (const [rawKey, value] of Object.entries(parsedUpdates)) {
          const trimmed = value.trim();
          if (!trimmed) continue;
          const canonical = resolveFieldKeyFromAi(
            rawKey,
            validKeys,
            fieldMap,
          );
          if (canonical) {
            allowedUpdates[canonical] = trimmed;
          }
        }

        if (Object.keys(allowedUpdates).length === 0) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "No highlighted field values were changed. Try naming the exact field, like `Effective Date`.",
            },
          ]);
          return;
        }

        const changed = applyFieldUpdates(allowedUpdates);

        if (changed) {
          const changedLabels = Object.keys(allowedUpdates)
            .map((key) => fieldMap[key]?.label ?? key)
            .join(", ");

          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Updated field values: ${changedLabels}.`,
            },
          ]);
          setStatus("editing");
          setEditCount((c) => c + 1);
          debouncedValidation();
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "No visible changes were applied. Try naming the exact highlighted field and new value.",
            },
          ]);
        }
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, there was an error. Please try again.",
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const statusConfig = {
    draft: {
      bg: "bg-orange-50 dark:bg-orange-900/20",
      text: "text-orange-700 dark:text-orange-300",
      border: "border-orange-300 dark:border-orange-700",
      dot: "bg-orange-600",
    },
    editing: {
      bg: "bg-green-50 dark:bg-green-900/20",
      text: "text-green-700 dark:text-green-300",
      border: "border-green-300 dark:border-green-700",
      dot: "bg-green-600",
    },
    saved: {
      bg: "bg-blue-50 dark:bg-blue-900/20",
      text: "text-blue-700 dark:text-blue-300",
      border: "border-blue-300 dark:border-blue-700",
      dot: "bg-blue-600",
    },
  };
  const sc = statusConfig[status];

  const hasErrors = validationErrors.length > 0;

  return (
    <div className="flex flex-col h-full bg-background print:bg-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
        @media print {
          .no-print { display: none !important; }
          .legal-paper { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      {/* Top Bar */}
      <div className="no-print flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="h-6 w-px bg-border" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-0 focus-visible:ring-0 font-medium text-lg px-2 bg-transparent text-foreground max-w-[400px]"
            placeholder="Document Title"
          />
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="text-muted-foreground hover:text-foreground"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="no-print flex-shrink-0 sticky top-0 z-20 flex items-center gap-1.5 px-4 py-2 bg-[#f9f6f1] dark:bg-card backdrop-blur border-b border-[#e0d8cf] dark:border-border">
            {(["bold", "italic", "underline"] as const).map((cmd) => (
              <button
                key={cmd}
                onClick={() => handleFormat(cmd)}
                className="w-8 h-8 border border-[#d5cec4] dark:border-border rounded bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80 cursor-pointer flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                {cmd === "bold" && <Bold className="w-3.5 h-3.5" />}
                {cmd === "italic" && <Italic className="w-3.5 h-3.5" />}
                {cmd === "underline" && <Underline className="w-3.5 h-3.5" />}
              </button>
            ))}

            <div className="w-px h-5 bg-[#d5cec4] dark:bg-border mx-1" />

            <button
              onClick={() => handleFormat("highlight")}
              title="Highlight"
              className="w-8 h-8 border border-[#d5cec4] dark:border-border rounded bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80 cursor-pointer flex items-center justify-center"
            >
              <Highlighter className="w-3.5 h-3.5 text-yellow-600" />
            </button>

            <div className="w-px h-5 bg-[#d5cec4] dark:bg-border mx-1" />

            {/* Active field info */}
            {focusedField ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/25 rounded-md border border-blue-200 dark:border-blue-800 min-w-0 overflow-hidden">
                <Pencil className="w-3 h-3 text-blue-500 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 truncate">
                  {focusedField.label}
                </span>
                <span className="text-[10px] text-blue-400 dark:text-blue-500 flex-shrink-0">
                  ·
                </span>
                <span className="text-[10px] text-blue-500/80 dark:text-blue-400/80 truncate flex-shrink-0">
                  {getFieldFormatHint(focusedField)}
                </span>
                {focusedField.required && (
                  <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1 py-px rounded flex-shrink-0">
                    Required
                  </span>
                )}
                {saveAttempted && focusedFieldError && (
                  <span className="text-[10px] text-red-500 dark:text-red-400 flex-shrink-0 truncate">
                    — {focusedFieldError.message}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground/50 italic select-none">
                Click a highlighted field to edit
              </span>
            )}

            <div className="flex-1" />

            {editCount > 0 && (
              <span className="text-xs text-[#8B7355]">
                {editCount} edit{editCount !== 1 ? "s" : ""}
              </span>
            )}

            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border",
                sc.bg,
                sc.text,
                sc.border,
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  sc.dot,
                  status === "editing" && "animate-pulse",
                )}
              />
              {status}
            </span>

            <div className="w-px h-5 bg-[#d5cec4] dark:bg-border mx-1" />

            <button
              onClick={() => setShowHighlights(!showHighlights)}
              title={
                showHighlights
                  ? "Dim field highlights"
                  : "Show field highlights"
              }
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 text-[11px] border rounded cursor-pointer transition-colors",
                showHighlights
                  ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
                  : "text-muted-foreground hover:text-foreground border-[#d5cec4] dark:border-border bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80",
              )}
            >
              {showHighlights ? (
                <Eye className="w-3 h-3" />
              ) : (
                <EyeOff className="w-3 h-3" />
              )}
              Fields
            </button>

            {templateId && TEMPLATE_REGISTRY[templateId] && (
              <>
                <button
                  type="button"
                  onClick={() => void downloadDocx()}
                  disabled={isDownloadingDocx}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#1a1a2e] text-[#f0ebe3] rounded cursor-pointer hover:bg-[#2a2a3e] transition-colors disabled:opacity-60"
                >
                  {isDownloadingDocx ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  DOCX
                </button>
                <button
                  type="button"
                  onClick={() => void applyEditsWithTrackChanges()}
                  disabled={isApplyingEdits}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-[#8B7355] text-white rounded cursor-pointer hover:bg-[#7a6548] transition-colors disabled:opacity-60 whitespace-nowrap"
                  title="Apply field changes as Track Changes in DOCX"
                >
                  {isApplyingEdits ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Pencil className="w-3 h-3" />
                  )}
                  Tracked
                </button>
              </>
            )}
            <button
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#8B7355] text-white rounded cursor-pointer hover:bg-[#7a6548] transition-colors"
            >
              <FileText className="w-3 h-3" />
              PDF
            </button>
          </div>

          {/* Validation Banner — only after save attempt */}
          {saveAttempted && hasErrors && (
            <div className="no-print flex-shrink-0 mx-4 mt-2 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-red-700 dark:text-red-300">
                  <div className="flex items-center justify-between">
                    <span>
                      <span className="font-semibold">
                        {validationErrors.length} issue
                        {validationErrors.length > 1 ? "s" : ""}.
                      </span>{" "}
                      Fix highlighted fields to save.
                    </span>
                    <button
                      onClick={() => setShowValidationDetails((v) => !v)}
                      className="ml-2 inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 font-medium"
                    >
                      {showValidationDetails ? "Hide" : "Show all"}
                      {showValidationDetails ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  {showValidationDetails && (
                    <ul className="mt-2 space-y-1">
                      {validationErrors.map((e) => (
                        <li
                          key={e.key}
                          className="flex items-center gap-1.5 py-0.5"
                        >
                          <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                          <span>{e.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Document Body */}
          <div className="flex-1 overflow-y-auto bg-[#eee8df] dark:bg-muted/30">
            <div className="max-w-[820px] mx-auto py-6 px-6 pb-20">
              <div className="legal-paper bg-[#f9f6f1] dark:bg-card rounded-md shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden border border-border/30">
                <div
                  id="legal-document-export-root"
                  className="px-12 py-5 pb-14"
                >
                  <div className="h-[3px] bg-gradient-to-r from-[#1a1a2e] via-[#8B7355] to-[#1a1a2e] rounded mb-2" />

                  {sections.map((s) => (
                    <EditableSection
                      key={s.id}
                      section={s}
                      isActive={activeSection === s.id}
                      onFocus={setActiveSection}
                      onUpdate={handleUpdate}
                      onFieldBlur={handleFieldSync}
                      onFieldFocus={setFocusedFieldKey}
                      showHighlights={showHighlights}
                      invalidFields={invalidFieldKeys}
                      showErrors={saveAttempted}
                      fieldMap={fieldMap}
                      sectionFieldLabels={sectionFieldLabelsById[s.id] ?? []}
                    />
                  ))}

                  <div className="mt-9">
                    <div className="h-px bg-[#d5cec4] dark:bg-border mb-2.5" />
                    <div className="flex justify-between text-[10px] text-[#b0a797] dark:text-muted-foreground italic">
                      <span>
                        Generated{" "}
                        {new Date().toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      <span>Page 1 of 1</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* AI Panel */}
        <div className="no-print w-[350px] flex-shrink-0 bg-background border-l border-border flex flex-col h-full">
          <div className="flex-shrink-0 p-4 border-b border-border bg-background/50 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-foreground">AI Assistant</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeSection
                ? "Ask AI to update only the highlighted field values"
                : "Select a section to get started"}
            </p>
          </div>

          <div className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              {chatMessages.length === 0 && (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p className="text-sm font-medium mb-2 flex items-center gap-2 text-foreground">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      How to use AI
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>&bull; Click a section to select it</li>
                      <li>&bull; Ask AI to update highlighted field values</li>
                      <li>&bull; AI will not rewrite the contract text</li>
                      <li>&bull; Hover highlighted fields to see names</li>
                    </ul>
                  </div>

                  {activeSection && (
                    <div>
                      <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-widest">
                        EDIT HIGHLIGHTED FIELDS
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Ask for exact field changes like changing a date, name,
                        address, title, or ownership percentage. Only the
                        highlighted values will be updated.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {chatMessages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded-2xl shadow-sm border border-border/50",
                    message.role === "user"
                      ? "bg-blue-100 dark:bg-blue-900/30 ml-4 border-blue-200/50"
                      : "bg-muted/50 mr-4",
                  )}
                >
                  <p className="text-[10px] font-black mb-1 text-muted-foreground uppercase tracking-widest">
                    {message.role === "user" ? "You" : "AI Assistant"}
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">
                    {message.content}
                  </p>
                </div>
              ))}

              {isProcessing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI is processing...
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 p-4 border-t border-border bg-background">
            <div className="space-y-2">
              {activeSection && (
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100/50 dark:border-blue-900/50 text-[10px]">
                  <p className="font-black mb-1 uppercase tracking-widest text-blue-600 dark:text-blue-400">
                    Fields In This Section
                  </p>
                  <p className="text-muted-foreground italic leading-relaxed">
                    {activeSectionFieldLabels.length > 0
                      ? activeSectionFieldLabels.join(", ")
                      : sections.find((s) => s.id === activeSection)?.label ??
                        activeSection}
                  </p>
                </div>
              )}
              <Textarea
                placeholder={
                  activeSection
                    ? "Ask AI to update highlighted fields..."
                    : "Select a section first..."
                }
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="resize-none bg-muted/30 border-border rounded-xl focus-visible:ring-blue-500"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAIRequest();
                  }
                }}
              />
              <Button
                onClick={() => void handleAIRequest()}
                disabled={!aiPrompt.trim() || isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 rounded-xl"
                size="sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send to AI
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
