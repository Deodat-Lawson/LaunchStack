"use client";

/**
 * Code block with a language picker, copy button, word-wrap toggle and
 * caption — the four affordances Notion puts on one.
 *
 * Highlighting comes from lowlight over the `highlight.js` grammars the app
 * already ships; only the common languages are registered so the editor
 * bundle does not carry two hundred parsers.
 */

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
    NodeViewContent,
    NodeViewWrapper,
    ReactNodeViewRenderer,
    type NodeViewProps,
} from "@tiptap/react";
import { Check, Copy, WrapText } from "lucide-react";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useState } from "react";

export const lowlight = createLowlight();

/** `[value, label]`, in the order the picker lists them. */
export const CODE_LANGUAGES: Array<[string, string]> = [
    ["plaintext", "Plain text"],
    ["bash", "Bash"],
    ["c", "C"],
    ["cpp", "C++"],
    ["csharp", "C#"],
    ["css", "CSS"],
    ["diff", "Diff"],
    ["go", "Go"],
    ["graphql", "GraphQL"],
    ["ini", "TOML / INI"],
    ["java", "Java"],
    ["javascript", "JavaScript"],
    ["json", "JSON"],
    ["kotlin", "Kotlin"],
    ["markdown", "Markdown"],
    ["php", "PHP"],
    ["python", "Python"],
    ["ruby", "Ruby"],
    ["rust", "Rust"],
    ["scss", "SCSS"],
    ["shell", "Shell"],
    ["sql", "SQL"],
    ["swift", "Swift"],
    ["typescript", "TypeScript"],
    ["xml", "HTML / XML"],
    ["yaml", "YAML"],
];

for (const [name, grammar] of [
    ["bash", bash],
    ["c", c],
    ["cpp", cpp],
    ["csharp", csharp],
    ["css", css],
    ["diff", diff],
    ["go", go],
    ["graphql", graphql],
    ["ini", ini],
    ["java", java],
    ["javascript", javascript],
    ["json", json],
    ["kotlin", kotlin],
    ["markdown", markdown],
    ["php", php],
    ["plaintext", plaintext],
    ["python", python],
    ["ruby", ruby],
    ["rust", rust],
    ["scss", scss],
    ["shell", shell],
    ["sql", sql],
    ["swift", swift],
    ["typescript", typescript],
    ["xml", xml],
    ["yaml", yaml],
] as const) {
    lowlight.register(name, grammar);
}

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
    const [copied, setCopied] = useState(false);
    const language = (node.attrs.language as string) || "plaintext";
    const wrap = Boolean(node.attrs.wrap);
    const editable = editor.isEditable;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(node.textContent);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Clipboard permission denied — nothing useful to say here.
        }
    };

    return (
        <NodeViewWrapper className="ntn-codeblock" data-wrap={wrap ? "true" : "false"}>
            <div className="ntn-codeblock__bar" contentEditable={false}>
                <select
                    className="ntn-codeblock__lang"
                    value={language}
                    disabled={!editable}
                    onChange={(event) => updateAttributes({ language: event.target.value })}
                >
                    {CODE_LANGUAGES.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
                <div className="ntn-codeblock__actions">
                    {editable && (
                        <button
                            type="button"
                            className={`ntn-codeblock__action${wrap ? " is-active" : ""}`}
                            title="Toggle word wrap"
                            onClick={() => updateAttributes({ wrap: !wrap })}
                        >
                            <WrapText size={13} />
                        </button>
                    )}
                    <button
                        type="button"
                        className="ntn-codeblock__action"
                        title="Copy"
                        onClick={() => void copy()}
                    >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                </div>
            </div>
            <pre className={`ntn-codeblock__pre language-${language}`}>
                <NodeViewContent<"code"> as="code" />
            </pre>
            {(editable || node.attrs.caption) && (
                <div
                    className={`ntn-codeblock__caption${node.attrs.caption ? "" : " is-empty"}`}
                    contentEditable={editable}
                    suppressContentEditableWarning
                    data-placeholder="Write a caption…"
                    onBlur={(event) =>
                        updateAttributes({ caption: event.currentTarget.textContent ?? "" })
                    }
                >
                    {node.attrs.caption as string}
                </div>
            )}
        </NodeViewWrapper>
    );
}

export const NotionCodeBlock = CodeBlockLowlight.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            wrap: {
                default: false,
                parseHTML: (element) => element.getAttribute("data-wrap") === "true",
                renderHTML: (attributes) => ({
                    "data-wrap": attributes.wrap ? "true" : "false",
                }),
            },
            caption: {
                default: "",
                parseHTML: (element) => element.getAttribute("data-caption") ?? "",
                renderHTML: (attributes) =>
                    attributes.caption ? { "data-caption": String(attributes.caption) } : {},
            },
        };
    },

    addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
    },

    addKeyboardShortcuts() {
        return {
            ...this.parent?.(),
            // Tab indents inside code instead of leaving the block, which is
            // what anyone typing code expects.
            Tab: ({ editor }) => {
                if (!editor.isActive(this.name)) return false;
                return editor.commands.insertContent("  ");
            },
        };
    },
}).configure({ lowlight, defaultLanguage: "plaintext" });
