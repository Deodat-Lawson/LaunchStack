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
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  List as ListIcon,
  Link as LinkIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  Eye,
  Download,
  Send,
  Sparkles,
  Wand2,
  Shield,
  FileText,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Save,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { legalTheme as lt } from "./LegalGeneratorTheme";
import type { EditorSection } from "@launchstack/features/legal-templates";
import type { TemplateField } from "@launchstack/features/legal-templates";
import {
  type FieldValidationError,
  buildTemplateFieldDataForDocx,
  extractFieldValuesFromSections,
  validateDocument,
} from "@launchstack/features/legal-templates";
import { TEMPLATE_REGISTRY } from "@launchstack/features/legal-templates";

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
  if (field.type === "date") return "date";
  if (field.type === "number") {
    const k = field.key;
    if (k.endsWith("_pct") || k === "discount_rate") return "0–100%";
    if (
      k.endsWith("_months") ||
      k.endsWith("_years") ||
      k.endsWith("_days") ||
      k === "total_shares" ||
      k === "eligibility_age" ||
      k === "vacation_days"
    )
      return "number";
    return "number";
  }
  if (field.type === "select" && field.options)
    return field.options.join(" / ");
  if (field.type === "textarea") return "free text";
  return "";
}

function buildFieldTooltip(field: TemplateField): string {
  const parts: string[] = [field.label];
  const hint = getFieldFormatHint(field);
  if (hint) parts.push(hint);
  if (field.required) parts.push("required");
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
  mark.textContent = "​";

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

function collapseRunsOfSpacesInTextNodes(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) nodes.push(n as Text);
  }
  for (const textNode of nodes) {
    const t = textNode.textContent ?? "";
    const next = t.replace(/ {2,}/g, " ");
    if (next !== t) textNode.textContent = next;
  }
}

function syncLegalMarkEmptyClass(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>("mark[data-field-key]").forEach((mark) => {
    const text = (mark.textContent ?? "").replace(/​/g, "").trim();
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
      const t = (m.textContent ?? "").replace(/​/g, "").trim();
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
  const visible = text.replace(/​/g, "");
  if (visible.length === 0) {
    e.preventDefault();
    mark.textContent = "​";
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
    const before = tn.slice(0, off).replace(/​/g, "");
    if (before.length === 1 && before[0] === onlyChar) {
      e.preventDefault();
      mark.textContent = "​";
      placeCaretInsideMark(mark);
      onSync();
      return true;
    }
    return false;
  }

  if (off >= tn.length) return false;
  if (tn[off] === "​") return false;
  const fromOff = tn.slice(off).replace(/​/g, "");
  if (fromOff.length >= 1 && fromOff[0] === onlyChar) {
    e.preventDefault();
    mark.textContent = "​";
    placeCaretInsideMark(mark);
    onSync();
    return true;
  }
  return false;
}

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

  const visible = (mark.textContent ?? "").replace(/​/g, "").trim();
  if (visible.length > 0) return false;

  e.preventDefault();
  mark.textContent = data;
  placeCaretInsideMark(mark);
  onSync();
  return true;
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

function groupFields(fields: TemplateField[]): {
  group: string;
  fields: TemplateField[];
}[] {
  const groups = new Map<string, TemplateField[]>();
  const groupOrder: string[] = [];
  for (const f of fields) {
    const g = inferFieldGroup(f);
    if (!groups.has(g)) {
      groups.set(g, []);
      groupOrder.push(g);
    }
    groups.get(g)!.push(f);
  }
  return groupOrder.map((g) => ({ group: g, fields: groups.get(g)! }));
}

function inferFieldGroup(field: TemplateField): string {
  const k = field.key;
  if (
    k.includes("party") ||
    k.includes("disclosing") ||
    k.includes("receiving") ||
    k.includes("assignor") ||
    k.includes("assignee") ||
    k.includes("founder") ||
    k.includes("company")
  ) {
    return "Parties";
  }
  if (k.includes("signat") || k.includes("witness")) {
    return "Signatures";
  }
  if (k.includes("governing_law") || k.includes("dispute") || k.includes("jurisdiction")) {
    return "Governing law";
  }
  if (
    k.includes("term") ||
    k.includes("notice") ||
    k.includes("survival") ||
    k.includes("vesting") ||
    k.includes("cliff") ||
    k.includes("date") ||
    k.includes("months") ||
    k.includes("years") ||
    k.includes("days")
  ) {
    return "Terms & dates";
  }
  return "Details";
}

function EditableSection({
  section,
  isActive,
  onFocus,
  onUpdate,
  onFieldBlur,
  onFieldFocus,
  invalidFields,
  showErrors,
  fieldMap,
}: {
  section: EditorSection;
  isActive: boolean;
  onFocus: (id: string) => void;
  onUpdate: (id: string, html: string) => void;
  onFieldBlur: (key: string, value: string) => void;
  onFieldFocus: (key: string) => void;
  invalidFields: Set<string>;
  showErrors: boolean;
  fieldMap: Record<string, TemplateField>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInternalEdit = useRef(false);
  const lastSetContent = useRef(section.content);
  const expectedFieldKeysOrderedRef = useRef<string[]>([]);
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
      const text = (mark.textContent ?? "").replace(/​/g, "").trim();
      if (text === "") {
        mark.textContent = "​";
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
    return <h1>{section.content}</h1>;
  }

  if (section.type === "heading") {
    return <h2>{section.content}</h2>;
  }

  return (
    <div
      ref={ref}
      data-legal-section-id={section.id}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      className={cn(lt.rdDocSection, isActive && "is-active")}
    />
  );
}

export function LegalDocumentEditor({
  initialTitle,
  sections: initialSections,
  templateId,
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

  const [paneTab, setPaneTab] = useState<"fields" | "ai" | "validate">("fields");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  const [validationErrors, setValidationErrors] = useState<
    FieldValidationError[]
  >([]);
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

  const fieldValues = useMemo(
    () => extractFieldValuesFromSections(sections.map((s) => s.content)),
    [sections],
  );

  const filledCount = useMemo(() => {
    let n = 0;
    for (const f of templateFields) {
      const v = (fieldValues[f.key] ?? "").trim();
      if (v && !v.startsWith("[")) n += 1;
    }
    return n;
  }, [fieldValues, templateFields]);

  const totalFields = templateFields.length;
  const progressPct = totalFields > 0 ? Math.round((filledCount / totalFields) * 100) : 0;

  const fieldGroups = useMemo(() => groupFields(templateFields), [templateFields]);

  const focusedField = focusedFieldKey ? (fieldMap[focusedFieldKey] ?? null) : null;
  const focusedFieldError = focusedFieldKey
    ? validationErrors.find((e) => e.key === focusedFieldKey)
    : null;

  const runValidation = useCallback(() => {
    const values = extractFieldValuesFromSections(
      sectionsRef.current.map((s) => s.content),
    );
    const result = validateDocument(values, templateFields);
    setValidationErrors(result.errors);
    return result;
  }, [templateFields]);

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

  /** Apply an update typed in the right-pane field input. */
  const handleFieldInputChange = useCallback(
    (key: string, value: string) => {
      const sanitized = value.replace(/[<>]/g, "");
      applyFieldUpdates({ [key]: sanitized || "" });
      setStatus("editing");
      setEditCount((c) => c + 1);
      debouncedValidation();
    },
    [applyFieldUpdates, debouncedValidation],
  );

  const handleFormat = (cmd: string) => {
    if (cmd === "highlight") {
      document.execCommand("hiliteColor", false, "#FFF59D");
    } else if (cmd === "removeHighlight") {
      document.execCommand("hiliteColor", false, "transparent");
    } else {
      document.execCommand(cmd, false, undefined);
    }
  };

  const getLiveExportSnapshot = useCallback((): {
    html: string;
    sections: EditorSection[];
  } => {
    const root = document.getElementById("legal-document-export-root");
    const nextSections = sections.map((s) => {
      if (s.type !== "paragraph") return s;
      const safe = s.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = root?.querySelector(`[data-legal-section-id="${safe}"]`);
      const inner = el instanceof HTMLElement ? el.innerHTML : s.content;
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
    const values = extractFieldValuesFromSections(
      snapshot.sections.map((s) => s.content),
    );
    const result = validateDocument(values, templateFields);
    setValidationErrors(result.errors);
    if (!result.valid) {
      setPaneTab("validate");
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
        body: JSON.stringify({ templateId, data, format: "json" }),
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
        description:
          error instanceof Error ? error.message : "Could not generate DOCX file",
        id: loadingToast,
        duration: 5000,
      });
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  const applyEditsWithTrackChanges = async () => {
    if (!templateId || !TEMPLATE_REGISTRY[templateId]) {
      toast.error("Template not configured", {
        description: "Unable to generate document. Please contact support.",
      });
      return;
    }

    const validation = runValidation();
    if (!validation.valid) {
      toast.error("Document has validation errors", {
        description: `Please fix ${validation.errors.length} field error${validation.errors.length > 1 ? "s" : ""} before applying track changes.`,
      });
      setPaneTab("validate");
      setSaveAttempted(true);
      return;
    }

    setIsApplyingEdits(true);
    const loadingToast = toast.loading("Generating document with track changes...");

    try {
      const { html } = getLiveExportSnapshot();
      const values = extractFieldValuesFromSections([html]);

      const template = TEMPLATE_REGISTRY[templateId];
      if (!template) throw new Error("Template not found");

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

      const res = await fetch("/api/document-generator/legal-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, data: placeholderData, format: "json" }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          errBody?.error || `Document generation failed: HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as {
        success?: boolean;
        docxBase64?: string;
        error?: string;
      };

      if (!json.success || !json.docxBase64) {
        throw new Error(json.error || "Failed to generate DOCX");
      }

      const edits: Array<{ target_text: string; new_text: string; comment?: string }> = [];
      for (const [key, value] of Object.entries(values)) {
        const cleanValue = value
          .replace(/<[^>]*>/g, "")
          .replace(/​/g, "")
          .trim();
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
        summary?: { applied_edits: number; skipped_edits: number };
        error?: string;
        message?: string;
      };

      if (!applyRes.ok || !applyJson.success || !applyJson.modifiedDocxBase64) {
        const err = new Error(
          applyJson.message || applyJson.error || "Failed to apply edits",
        );
        (err as Error & { serverError?: string }).serverError = applyJson.error;
        throw err;
      }

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

      if (
        serverError.includes("not configured") ||
        errMsg.includes("not configured") ||
        errMsg.includes("ADEU_SERVICE_URL")
      ) {
        errorMessage = "Track Changes not configured";
        errorDescription =
          "The redlining service (Adeu) is not set up. Ask your admin to configure ADEU_SERVICE_URL.";
      } else if (
        errMsg.includes("ECONNREFUSED") ||
        errMsg.includes("ENOTFOUND") ||
        errMsg.includes("fetch failed") ||
        errMsg.includes("Failed to fetch")
      ) {
        errorMessage = "Redlining service unreachable";
        errorDescription =
          "The Adeu service is not running. Start it with Docker Compose or check ADEU_SERVICE_URL in your .env.";
      } else if (
        errMsg.includes("Batch rejected") ||
        errMsg.includes("Ambiguous match")
      ) {
        errorMessage = "Track Changes failed";
        errorDescription =
          "Some field edits could not be applied. The document may have duplicate field references.";
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

    setIsProcessing(true);
    setChatMessages((prev) => [...prev, { role: "user", content: aiPrompt }]);
    const prompt = aiPrompt;
    setAiPrompt("");

    const sectionContent = getSelectedSectionContent();
    const sectionFieldKeys = sectionContent ? extractFieldKeysFromHtml(sectionContent) : [];
    const targetKeys = sectionFieldKeys.length > 0
      ? sectionFieldKeys
      : templateFields.map((f) => f.key);

    const sectionFields = targetKeys
      .map((key) => fieldMap[key])
      .filter((field): field is TemplateField => Boolean(field));

    if (sectionFields.length === 0) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "This document does not have editable highlighted fields.",
        },
      ]);
      setIsProcessing(false);
      return;
    }

    const focusedSectionField =
      focusedFieldKey && targetKeys.includes(focusedFieldKey)
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
            fullContent: sectionContent || sections.map((s) => s.content).join("\n"),
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
                "I couldn't parse a field change from that. Try naming the exact field, e.g. \"set Effective Date to March 4, 2026\".",
            },
          ]);
          return;
        }

        const validKeys = new Set<string>();
        for (const k of extractAllFieldKeysFromSections(sectionsRef.current)) {
          validKeys.add(k);
        }
        for (const f of templateFields) validKeys.add(f.key);

        const allowedUpdates: Record<string, string> = {};
        for (const [rawKey, value] of Object.entries(parsedUpdates)) {
          const trimmed = value.trim();
          if (!trimmed) continue;
          const canonical = resolveFieldKeyFromAi(rawKey, validKeys, fieldMap);
          if (canonical) allowedUpdates[canonical] = trimmed;
        }

        if (Object.keys(allowedUpdates).length === 0) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "No matching fields were updated. Try naming the exact field, like \"Effective Date\".",
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
              content: `Updated: ${changedLabels}.`,
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
              content: "No visible changes. Try naming the exact field and new value.",
            },
          ]);
        }
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, there was an error. Please try again." },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const activeTemplateName =
    TEMPLATE_REGISTRY[templateId]?.name ?? "Document";

  const statusBadgeClass =
    status === "saved"
      ? lt.rdDocBadge
      : status === "editing"
        ? lt.rdDocBadgeWarn
        : lt.rdDocBadge;
  const statusLabel =
    status === "saved"
      ? "SAVED"
      : status === "editing"
        ? "DRAFT · UNSAVED"
        : "DRAFT · AUTOSAVED";

  return (
    <div className="flex h-full flex-col">
      {/* Top bar (breadcrumb + global save) */}
      <div className={lt.rdTop}>
        <div className={lt.rdCrumbs}>
          <button
            type="button"
            onClick={onBack}
            className={lt.rdBtnGhost}
            style={{ padding: "4px 8px" }}
            aria-label="Back to documents"
          >
            Drift
          </button>
          <span className={lt.rdCrumbsSep}>/</span>
          <span style={{ color: "var(--ink-2)" }}>Legal</span>
          <span className={lt.rdCrumbsSep}>/</span>
          <span className={lt.rdCrumbsLast} title={title || activeTemplateName}>
            {title || activeTemplateName}
          </span>
        </div>
        <div className={lt.rdTopSpacer} />
        {lastSaved && (
          <span
            className="flex items-center gap-1.5"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            <CheckCircle className="h-3 w-3" style={{ color: "var(--success)" }} />
            Saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className={lt.rdBtnAccent}
          style={{ padding: "6px 12px", fontSize: 12 }}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>

      {/* Three-pane workspace */}
      <div className={lt.rdLegal}>
        {/* Document */}
        <section className={lt.rdDoc}>
          <div className={lt.rdDocHead}>
            <div>
              <div className={lt.rdDocTitleRow}>
                <input
                  className={lt.rdDocTitle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Document title"
                />
                <span className={statusBadgeClass}>{statusLabel}</span>
              </div>
              <div className={lt.rdDocMeta}>
                <span className={lt.rdDocMetaItem}>
                  <FileText />
                  {activeTemplateName}
                </span>
                {editCount > 0 && (
                  <span className={lt.rdDocMetaItem}>{editCount} edits</span>
                )}
                <span className={lt.rdDocProgress}>
                  <span>
                    {filledCount} of {totalFields} fields
                  </span>
                  <span className={lt.rdDocProgressBar}>
                    <span
                      className={lt.rdDocProgressFill}
                      style={{ width: `${progressPct}%` }}
                    />
                  </span>
                  <span>{progressPct}%</span>
                </span>
              </div>
            </div>
            <div className={lt.rdDocActions}>
              <button
                type="button"
                className={lt.rdBtnGhost}
                onClick={() => setShowHighlights((v) => !v)}
                title={showHighlights ? "Hide field highlights" : "Show field highlights"}
              >
                <Eye />
                {showHighlights ? "Hide fields" : "Show fields"}
              </button>
              {templateId && TEMPLATE_REGISTRY[templateId] && (
                <>
                  <button
                    type="button"
                    className={lt.rdBtnOutline}
                    onClick={() => void downloadDocx()}
                    disabled={isDownloadingDocx}
                  >
                    {isDownloadingDocx ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download />
                    )}
                    Export DOCX
                  </button>
                  <button
                    type="button"
                    className={lt.rdBtnAccent}
                    onClick={() => void applyEditsWithTrackChanges()}
                    disabled={isApplyingEdits}
                  >
                    {isApplyingEdits ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send />
                    )}
                    Send for review
                  </button>
                </>
              )}
            </div>
          </div>

          <div className={lt.rdToolbar}>
            <div className={lt.rdToolbarGroup}>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("undo")}
                title="Undo"
                aria-label="Undo"
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("redo")}
                title="Redo"
                aria-label="Redo"
              >
                <RedoIcon />
              </button>
            </div>
            <div className={lt.rdToolbarGroup}>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("bold")}
                title="Bold"
                aria-label="Bold"
              >
                <Bold />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("italic")}
                title="Italic"
                aria-label="Italic"
              >
                <Italic />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("underline")}
                title="Underline"
                aria-label="Underline"
              >
                <Underline />
              </button>
            </div>
            <div className={lt.rdToolbarGroup}>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("justifyLeft")}
                title="Align left"
                aria-label="Align left"
              >
                <AlignLeft />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("justifyCenter")}
                title="Align center"
                aria-label="Align center"
              >
                <AlignCenter />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("insertUnorderedList")}
                title="List"
                aria-label="List"
              >
                <ListIcon />
              </button>
              <button
                type="button"
                className={lt.rdToolBtn}
                onClick={() => handleFormat("highlight")}
                title="Highlight"
                aria-label="Highlight"
              >
                <LinkIcon />
              </button>
            </div>
            <div className={lt.rdToolStatus}>
              {focusedField ? (
                <span
                  className={lt.rdToolFieldChip}
                  title={buildFieldTooltip(focusedField)}
                >
                  <Pencil />
                  <span className={lt.rdToolFieldChipLabel}>{focusedField.label}</span>
                  {getFieldFormatHint(focusedField) && (
                    <span className={lt.rdToolFieldChipHint}>
                      · {getFieldFormatHint(focusedField)}
                    </span>
                  )}
                  {focusedField.required && (
                    <span className={lt.rdToolFieldChipReq}>REQ</span>
                  )}
                  {saveAttempted && focusedFieldError && (
                    <span style={{ color: "var(--danger)", fontSize: 10 }}>
                      · {focusedFieldError.message}
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
                  Click a highlighted field to edit
                </span>
              )}
            </div>
          </div>

          {saveAttempted && validationErrors.length > 0 && (
            <div className={lt.rdValBanner}>
              <AlertTriangle />
              <div>
                <strong>{validationErrors.length}</strong> issue
                {validationErrors.length > 1 ? "s" : ""} blocking save —{" "}
                <button
                  type="button"
                  onClick={() => setPaneTab("validate")}
                  style={{
                    background: "transparent",
                    border: 0,
                    color: "var(--danger)",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  view in validate tab
                </button>
              </div>
            </div>
          )}

          <div className={cn(lt.rdDocScroll, lt.scrollbar)}>
            <div
              id="legal-document-export-root"
              className={cn(lt.rdDocPage, !showHighlights && lt.rdDocPageDimMarks)}
            >
              {sections.map((s) => (
                <EditableSection
                  key={s.id}
                  section={s}
                  isActive={activeSection === s.id}
                  onFocus={setActiveSection}
                  onUpdate={handleUpdate}
                  onFieldBlur={handleFieldSync}
                  onFieldFocus={setFocusedFieldKey}
                  invalidFields={invalidFieldKeys}
                  showErrors={saveAttempted}
                  fieldMap={fieldMap}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Right: tabbed pane */}
        <aside className={lt.rdPane}>
          <div className={lt.rdPaneTabs}>
            <button
              type="button"
              className={cn(lt.rdPaneTab, paneTab === "fields" && lt.rdPaneTabActive)}
              onClick={() => setPaneTab("fields")}
            >
              <ListIcon />
              Fields
              <span className={lt.rdPaneTabCount}>
                {filledCount}/{totalFields}
              </span>
            </button>
            <button
              type="button"
              className={cn(lt.rdPaneTab, paneTab === "ai" && lt.rdPaneTabActive)}
              onClick={() => setPaneTab("ai")}
            >
              <Sparkles />
              AI Assist
            </button>
            <button
              type="button"
              className={cn(lt.rdPaneTab, paneTab === "validate" && lt.rdPaneTabActive)}
              onClick={() => setPaneTab("validate")}
            >
              <Shield />
              Validate
              {validationErrors.length > 0 && (
                <span className={cn(lt.rdPaneTabCount, lt.rdPaneTabCountWarn)}>
                  {validationErrors.length}
                </span>
              )}
            </button>
          </div>

          <div className={cn(lt.rdPaneBody, lt.scrollbar)}>
            {paneTab === "fields" &&
              fieldGroups.map((group) => {
                const groupFilled = group.fields.filter((f) => {
                  const v = (fieldValues[f.key] ?? "").trim();
                  return v && !v.startsWith("[");
                }).length;
                return (
                  <div key={group.group} className={lt.rdFieldGroup}>
                    <div className={lt.rdFieldGroupHead}>
                      <span className={lt.rdFieldGroupTitle}>{group.group}</span>
                      <span className={lt.rdFieldGroupCount}>
                        {groupFilled} of {group.fields.length}
                      </span>
                    </div>
                    {group.fields.map((field) => {
                      const value = fieldValues[field.key] ?? "";
                      const filled = value.trim() && !value.trim().startsWith("[");
                      const err = saveAttempted
                        ? validationErrors.find((e) => e.key === field.key)
                        : null;
                      const hint = getFieldFormatHint(field);
                      const placeholder = field.required
                        ? `e.g. ${field.label.toLowerCase()}`
                        : `Optional · ${field.label.toLowerCase()}`;
                      const id = `legal-field-${field.key}`;
                      return (
                        <div key={field.key} className={lt.rdField}>
                          <label className={lt.rdFieldLabel} htmlFor={id}>
                            <span className={lt.rdFieldLabelTitle}>
                              {field.label}
                              {field.required && (
                                <span className={lt.rdFieldReq}>*</span>
                              )}
                            </span>
                            {hint && <span className={lt.rdFieldHint}>{hint}</span>}
                          </label>
                          {field.type === "textarea" ? (
                            <textarea
                              id={id}
                              className={cn(
                                lt.rdFieldInput,
                                filled && lt.rdFieldInputFilled,
                                err && lt.rdFieldInputError,
                              )}
                              value={filled ? value : ""}
                              placeholder={placeholder}
                              rows={3}
                              onChange={(e) =>
                                handleFieldInputChange(field.key, e.target.value)
                              }
                              onFocus={() => setFocusedFieldKey(field.key)}
                            />
                          ) : field.type === "select" && field.options ? (
                            <select
                              id={id}
                              className={cn(
                                lt.rdFieldInput,
                                filled && lt.rdFieldInputFilled,
                                err && lt.rdFieldInputError,
                              )}
                              value={filled ? value : ""}
                              onChange={(e) =>
                                handleFieldInputChange(field.key, e.target.value)
                              }
                              onFocus={() => setFocusedFieldKey(field.key)}
                            >
                              <option value="">Select…</option>
                              {field.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={id}
                              type={field.type === "date" ? "date" : "text"}
                              className={cn(
                                lt.rdFieldInput,
                                filled && lt.rdFieldInputFilled,
                                err && lt.rdFieldInputError,
                              )}
                              value={filled ? value : ""}
                              placeholder={placeholder}
                              onChange={(e) =>
                                handleFieldInputChange(field.key, e.target.value)
                              }
                              onFocus={() => setFocusedFieldKey(field.key)}
                            />
                          )}
                          {err && (
                            <div className={lt.rdFieldErrorMsg}>{err.message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

            {paneTab === "ai" && (
              <>
                <div className={lt.rdFieldGroup}>
                  <div className={lt.rdFieldGroupTitle} style={{ marginBottom: 10 }}>
                    Ask Drift
                  </div>
                  <textarea
                    className={lt.rdTextarea}
                    placeholder={
                      activeSection
                        ? "Ask AI to update highlighted fields…"
                        : "Click a section in the document, or describe a field change…"
                    }
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleAIRequest();
                      }
                    }}
                  />
                  <div className={lt.rdPresets}>
                    {[
                      "Set effective date to today",
                      "Use Delaware as governing law",
                      "Tighten the term to 18 months",
                      "Fill remaining required fields with placeholders",
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={lt.rdPreset}
                        onClick={() => setAiPrompt(preset)}
                        disabled={isProcessing}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className={lt.rdBtnAccent}
                      onClick={() => void handleAIRequest()}
                      disabled={!aiPrompt.trim() || isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send />
                      )}
                      {isProcessing ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>

                {chatMessages.length > 0 && (
                  <div className={lt.rdFieldGroup}>
                    <div className={lt.rdFieldGroupTitle} style={{ marginBottom: 10 }}>
                      Recent
                    </div>
                    <div className={lt.rdChatList}>
                      {chatMessages.slice(-6).map((m, i) => (
                        <div
                          key={i}
                          className={cn(
                            lt.rdChatBubble,
                            m.role === "user"
                              ? lt.rdChatBubbleUser
                              : lt.rdChatBubbleAssistant,
                          )}
                        >
                          {m.content}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className={lt.rdAiCard}>
                  <div className={lt.rdAiCardHead}>
                    <Wand2 />
                    <span className={lt.rdAiCardTitle}>Tip</span>
                  </div>
                  <div className={lt.rdAiCardBody}>
                    Drift only edits highlighted fields — it won't rewrite contract clauses.
                    Reference fields by their exact label (e.g. "Effective Date") for the
                    cleanest results.
                  </div>
                </div>
              </>
            )}

            {paneTab === "validate" && (
              <>
                <div className={lt.rdFieldGroup}>
                  <div className={lt.rdFieldGroupTitle} style={{ marginBottom: 10 }}>
                    Open issues · {validationErrors.length}
                  </div>
                  {validationErrors.length === 0 ? (
                    <div className={cn(lt.rdIssue, lt.rdIssueOk)}>
                      <span className={lt.rdIssueIcon}>
                        <CheckCircle />
                      </span>
                      <div>
                        <div className={lt.rdIssueTitle}>All required fields complete</div>
                        <div className={lt.rdIssueBody}>
                          You can save or send this document for review.
                        </div>
                      </div>
                    </div>
                  ) : (
                    validationErrors.map((err) => (
                      <div key={err.key} className={cn(lt.rdIssue, lt.rdIssueWarn)}>
                        <span className={lt.rdIssueIcon}>
                          <AlertTriangle />
                        </span>
                        <div>
                          <div className={lt.rdIssueTitle}>
                            {fieldMap[err.key]?.label ?? err.key}
                          </div>
                          <div className={lt.rdIssueBody}>{err.message}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className={lt.rdFieldGroup}>
                  <div className={lt.rdFieldGroupTitle} style={{ marginBottom: 10 }}>
                    Passed checks · {totalFields - validationErrors.length}
                  </div>
                  {[
                    `${filledCount} of ${totalFields} fields filled`,
                    progressPct >= 100 ? "All required values present" : null,
                    "Field placeholders preserved in source HTML",
                  ]
                    .filter(Boolean)
                    .map((t, i) => (
                      <div key={i} className={cn(lt.rdIssue, lt.rdIssueOk)}>
                        <span className={lt.rdIssueIcon}>
                          <CheckCircle />
                        </span>
                        <div>{t}</div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
