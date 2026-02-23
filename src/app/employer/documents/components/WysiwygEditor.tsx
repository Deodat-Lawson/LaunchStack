"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { marked } from "marked";
import TurndownService from "turndown";
import { useImperativeHandle, useRef, forwardRef } from "react";

const turndown = new TurndownService({ headingStyle: "atx" });

function toHtml(md: string): string {
  if (!md.trim()) return "<p></p>";
  if (md.trim().startsWith("<") && md.includes(">")) return md;
  try {
    return String(marked.parse(md, { async: false }));
  } catch {
    return md;
  }
}

/** Convert Markdown to HTML for inline insertion (strips outer <p> for single-paragraph content). */
function markdownToInlineHtml(md: string): string {
  if (!md.trim()) return "";
  if (md.trim().startsWith("<") && md.includes(">")) return md;
  try {
    const html = String(marked.parse(md, { async: false }));
    const m = /^<p>(.*)<\/p>$/s.exec(html);
    return m ? m[1]! : html;
  } catch {
    return md;
  }
}

function extractTextAtCursor(text: string, cursorPos: number): { text: string; start: number; end: number } {
  if (text.length === 0) return { text: "", start: 0, end: 0 };
  let start = cursorPos;
  let end = cursorPos;
  const len = text.length;
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

/** Map character offsets to ProseMirror from/to by scanning doc. */
function findPositions(doc: { textBetween: (from: number, to: number) => string }, startChar: number, endChar: number): { from: number; to: number } {
  let from = 1;
  let to = 1;
  for (let pos = 1; pos < 100000; pos++) {
    const count = doc.textBetween(0, pos).length;
    if (count >= startChar && from === 1) from = pos;
    if (count >= endChar) {
      to = pos;
      break;
    }
  }
  return { from, to };
}

export interface WysiwygEditorHandle {
  getHtml: () => string;
  getMarkdown: () => string;
  getText: () => string;
  getSelection: () => { text: string; from: number; to: number; textBefore: string; textAfter: string } | null;
  getExtractedAtCursor: () => { text: string; from: number; to: number; textBefore: string; textAfter: string } | null;
  insertContent: (html: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  /** Replace by text context - uses character offsets for accurate range when selection may have collapsed. */
  replaceRangeByTextContext: (textBefore: string, originalText: string, proposedText: string) => boolean;
  setContent: (html: string) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  setTextAlign: (align: "left" | "center" | "right" | "justify") => void;
  focus: () => void;
}

export interface SelectionInfo {
  text: string;
  from: number;
  to: number;
  textBefore: string;
  textAfter: string;
}

interface WysiwygEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  onSelectionChange?: (info: SelectionInfo) => void;
  placeholder?: string;
  className?: string;
}

export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor({ initialContent, onChange, onSelectionChange, placeholder: _placeholder, className }, ref) {
    const initialHtmlRef = useRef(toHtml(initialContent));
    initialHtmlRef.current = toHtml(initialContent);
    const onChangeRef = useRef(onChange);
    const onSelectionRef = useRef(onSelectionChange);
    onChangeRef.current = onChange;
    onSelectionRef.current = onSelectionChange;

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
      ],
      content: initialHtmlRef.current,
      editorProps: {
        attributes: {
          class: [
            "focus:outline-none min-h-[900px] text-base leading-relaxed text-foreground",
            "[&_p]:my-3 [&_p]:leading-relaxed",
            "[&_strong]:font-bold",
            "[&_em]:italic [&_u]:underline",
            "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2",
            "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2",
            "[&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-2",
            "[&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-3 [&_ul]:space-y-1",
            "[&_ol]:list-decimal [&_ol]:pl-8 [&_ol]:my-3 [&_ol]:space-y-1",
            "[&_li]:leading-relaxed",
            "[&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-3",
            "[&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-sm",
          ].join(" "),
        },
        handleDOMEvents: {
          blur: () => {
            const html = editor?.getHTML() ?? "";
            onChangeRef.current?.(html);
          },
        },
      },
      onUpdate: ({ editor }) => {
        const html = editor.getHTML();
        onChangeRef.current?.(html);
      },
      onSelectionUpdate: ({ editor }) => {
        const { doc } = editor.state;
        const { from, to } = editor.state.selection;
        const end = doc.content.size;
        const text = doc.textBetween(from, Math.min(to, end));
        const textBefore = doc.textBetween(0, from);
        const textAfter = doc.textBetween(Math.min(to, end), end);
        onSelectionRef.current?.({ text, from, to, textBefore, textAfter });
      },
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getHtml: () => editor?.getHTML() ?? "",
        getMarkdown: () => (editor ? turndown.turndown(editor.getHTML()) : ""),
        getText: () => editor?.getText() ?? "",
        getSelection: () => {
          if (!editor) return null;
          const { doc } = editor.state;
          const { from, to } = editor.state.selection;
          const end = doc.content.size;
          const text = doc.textBetween(from, Math.min(to, end));
          const textBefore = doc.textBetween(0, from);
          const textAfter = doc.textBetween(Math.min(to, end), end);
          return { text, from, to, textBefore, textAfter };
        },
        getExtractedAtCursor: () => {
          if (!editor) return null;
          const { doc } = editor.state;
          const { from } = editor.state.selection;
          const end = doc.content.size;
          const text = editor.getText();
          const cursorCharOffset = doc.textBetween(0, from).length;
          const extracted = extractTextAtCursor(text, cursorCharOffset);
          if (!extracted.text) return null;
          const { from: fromPos, to: toPos } = findPositions(doc, extracted.start, extracted.end);
          return {
            text: extracted.text,
            from: fromPos,
            to: toPos,
            textBefore: doc.textBetween(0, fromPos),
            textAfter: doc.textBetween(Math.min(toPos, end), end),
          };
        },
        insertContent: (html: string) => {
          editor?.chain().focus().insertContent(html).run();
        },
        replaceRange: (from: number, to: number, text: string) => {
          editor?.chain().focus().insertContentAt({ from, to }, text).run();
        },
        replaceRangeByTextContext: (textBefore: string, originalText: string, proposedText: string) => {
          if (!editor) return false;
          const { doc } = editor.state;
          const startChar = textBefore.length;
          const endChar = textBefore.length + originalText.length;
          const { from: fromPos, to } = findPositions(doc, startChar, endChar);
          let from = fromPos;
          if (from > 1) from -= 1;
          const content = markdownToInlineHtml(proposedText);
          editor.chain().focus().insertContentAt({ from, to }, content || proposedText).run();
          return true;
        },
        setContent: (html: string) => {
          editor?.commands.setContent(html);
        },
        toggleBold: () => editor?.chain().focus().toggleBold().run(),
        toggleItalic: () => editor?.chain().focus().toggleItalic().run(),
        toggleUnderline: () => editor?.chain().focus().toggleUnderline().run(),
        toggleBulletList: () => editor?.chain().focus().toggleBulletList().run(),
        toggleOrderedList: () => editor?.chain().focus().toggleOrderedList().run(),
        setTextAlign: (align: "left" | "center" | "right" | "justify") => {
          editor?.chain().focus().setTextAlign(align).run();
        },
        focus: () => editor?.commands.focus(),
      }),
      [editor]
    );

    if (!editor) return null;

    return (
      <div className={className}>
        <EditorContent editor={editor} />
      </div>
    );
  }
);
