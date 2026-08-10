"use client";

/**
 * A read-only renderer for stored documents.
 *
 * Synced blocks, page-history previews, and database card previews all need to
 * show a document they are not editing. Mounting a second Tiptap instance for
 * each would cost a ProseMirror view per block and pull the extension list
 * into a circular import, so those surfaces render the JSON directly.
 */

import { Fragment, type CSSProperties, type ReactNode } from "react";

import { attrText } from "~/lib/prosemirror-attrs";
import { backgroundColorValue, textColorValue } from "./colors";

export interface RenderNode {
    type?: string;
    attrs?: Record<string, unknown> | null;
    content?: RenderNode[];
    marks?: Array<{ type: string; attrs?: Record<string, unknown> | null }>;
    text?: string;
}

function markStyle(marks: RenderNode["marks"]): CSSProperties | undefined {
    let style: CSSProperties | undefined;
    for (const mark of marks ?? []) {
        if (mark.type !== "textStyle" && mark.type !== "highlight") continue;
        const color = mark.attrs?.color;
        const background = mark.attrs?.backgroundColor ?? mark.attrs?.color;
        style ??= {};
        if (mark.type === "textStyle" && typeof color === "string") style.color = color;
        if (mark.type === "highlight" && typeof background === "string") {
            style.background = background;
        }
    }
    return style;
}

function renderInline(nodes: RenderNode[] | undefined, keyPrefix: string): ReactNode {
    if (!nodes) return null;
    return nodes.map((node, index) => {
        const key = `${keyPrefix}-${index}`;

        if (node.type === "hardBreak") return <br key={key} />;
        if (node.type === "inlineMath") {
            return (
                <code key={key} className="ntn-math ntn-math--inline">
                    {attrText(node.attrs?.latex, "")}
                </code>
            );
        }
        if (node.type === "mention") {
            return (
                <span key={key} className="ntn-mention">
                    {attrText(node.attrs?.label, node.attrs?.id, "")}
                </span>
            );
        }
        if (node.type !== "text") return <Fragment key={key}>{renderInline(node.content, key)}</Fragment>;

        let element: ReactNode = node.text;
        const style = markStyle(node.marks);
        if (style) element = <span style={style}>{element}</span>;

        for (const mark of node.marks ?? []) {
            switch (mark.type) {
                case "bold":
                    element = <strong>{element}</strong>;
                    break;
                case "italic":
                    element = <em>{element}</em>;
                    break;
                case "strike":
                    element = <s>{element}</s>;
                    break;
                case "underline":
                    element = <u>{element}</u>;
                    break;
                case "code":
                    element = <code className="ntn-code-inline">{element}</code>;
                    break;
                case "link":
                    element = (
                        <a
                            href={attrText(mark.attrs?.href, "#")}
                            target="_blank"
                            rel="noreferrer"
                            className="ntn-link"
                        >
                            {element}
                        </a>
                    );
                    break;
                default:
                    break;
            }
        }

        return <Fragment key={key}>{element}</Fragment>;
    });
}

function blockStyle(attrs: Record<string, unknown> | null | undefined): CSSProperties | undefined {
    const color = textColorValue(attrs?.blockColor as string | undefined);
    const background = backgroundColorValue(attrs?.blockBackground as string | undefined);
    if (!color && !background) return undefined;
    return {
        ...(color ? { color } : {}),
        ...(background ? { background, padding: "3px 8px", borderRadius: 4 } : {}),
    };
}

function renderBlocks(nodes: RenderNode[] | undefined, keyPrefix: string): ReactNode {
    if (!nodes) return null;
    return nodes.map((node, index) => renderBlock(node, `${keyPrefix}-${index}`));
}

function renderBlock(node: RenderNode, key: string): ReactNode {
    const style = blockStyle(node.attrs);

    switch (node.type) {
        case "paragraph":
            return (
                <p key={key} style={style}>
                    {renderInline(node.content, key)}
                </p>
            );
        case "heading": {
            const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
            const Tag = (`h${level}` as unknown) as "h1" | "h2" | "h3";
            return (
                <Tag key={key} style={style}>
                    {renderInline(node.content, key)}
                </Tag>
            );
        }
        case "blockquote":
            return (
                <blockquote key={key} className="ntn-quote" style={style}>
                    {renderBlocks(node.content, key)}
                </blockquote>
            );
        case "codeBlock":
            return (
                <pre key={key} className="ntn-code">
                    <code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code>
                </pre>
            );
        case "bulletList":
            return (
                <ul key={key} className="ntn-list ntn-list--bullet">
                    {renderBlocks(node.content, key)}
                </ul>
            );
        case "orderedList":
            return (
                <ol key={key} className="ntn-list ntn-list--ordered">
                    {renderBlocks(node.content, key)}
                </ol>
            );
        case "listItem":
            return <li key={key}>{renderBlocks(node.content, key)}</li>;
        case "taskList":
            return (
                <ul key={key} className="ntn-list ntn-list--task">
                    {renderBlocks(node.content, key)}
                </ul>
            );
        case "taskItem":
            return (
                <li key={key} className="ntn-task" data-checked={Boolean(node.attrs?.checked)}>
                    <input type="checkbox" checked={Boolean(node.attrs?.checked)} readOnly />
                    <div>{renderBlocks(node.content, key)}</div>
                </li>
            );
        case "callout":
            return (
                <div
                    key={key}
                    className="ntn-callout"
                    style={{
                        background:
                            backgroundColorValue(node.attrs?.color as string | undefined) ??
                            "var(--panel-2)",
                    }}
                >
                    <div className="ntn-callout__icon">{attrText(node.attrs?.emoji, "💡")}</div>
                    <div className="ntn-callout__body">{renderBlocks(node.content, key)}</div>
                </div>
            );
        case "details": {
            const [summary, ...body] = node.content ?? [];
            return (
                <details key={key} className="ntn-toggle" open={Boolean(node.attrs?.open)}>
                    <summary>{renderInline(summary?.content?.[0]?.content, key)}</summary>
                    <div className="ntn-toggle__body">{renderBlocks(body, key)}</div>
                </details>
            );
        }
        case "horizontalRule":
            return <hr key={key} className="ntn-divider" />;
        case "blockMath":
            return (
                <div key={key} className="ntn-math ntn-math--block">
                    {attrText(node.attrs?.latex, "")}
                </div>
            );
        case "imageBlock":
            return node.attrs?.src ? (
                <figure key={key} className="ntn-media__figure">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={attrText(node.attrs.src)}
                        alt={attrText(node.attrs.caption, "")}
                        className="ntn-media__img"
                    />
                    {node.attrs.caption ? (
                        <figcaption className="ntn-media__caption">
                            {attrText(node.attrs.caption)}
                        </figcaption>
                    ) : null}
                </figure>
            ) : null;
        case "bookmark":
        case "embedBlock":
        case "videoBlock":
        case "audioBlock":
        case "fileBlock":
            return node.attrs?.url ?? node.attrs?.src ? (
                <a
                    key={key}
                    className="ntn-link"
                    href={attrText(node.attrs?.url, node.attrs?.src)}
                    target="_blank"
                    rel="noreferrer"
                >
                    {attrText(node.attrs?.title, node.attrs?.name, node.attrs?.url, node.attrs?.src)}
                </a>
            ) : null;
        case "pageLink":
            return (
                <div key={key} className="ntn-page-link ntn-page-link--static">
                    <span className="ntn-page-link__icon">
                        {String((node.attrs?.icon as { value?: string } | null)?.value ?? "📄")}
                    </span>
                    <span className="ntn-page-link__title">
                        {attrText(node.attrs?.title, "Untitled")}
                    </span>
                </div>
            );
        case "columns":
            return (
                <div key={key} className="ntn-columns">
                    {(node.content ?? []).map((column, index) => (
                        <div key={`${key}-c${index}`} className="ntn-column">
                            {renderBlocks(column.content, `${key}-c${index}`)}
                        </div>
                    ))}
                </div>
            );
        case "table":
            return (
                <div key={key} className="ntn-table-wrap">
                    <table className="ntn-table">
                        <tbody>
                            {(node.content ?? []).map((row, rowIndex) => (
                                <tr key={`${key}-r${rowIndex}`}>
                                    {(row.content ?? []).map((cell, cellIndex) => {
                                        const Cell = cell.type === "tableHeader" ? "th" : "td";
                                        return (
                                            <Cell key={`${key}-r${rowIndex}-c${cellIndex}`}>
                                                {renderBlocks(
                                                    cell.content,
                                                    `${key}-r${rowIndex}-c${cellIndex}`
                                                )}
                                            </Cell>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        default:
            return node.content ? (
                <Fragment key={key}>{renderBlocks(node.content, key)}</Fragment>
            ) : null;
    }
}

/** Render a stored document read-only. */
export function RenderDoc({
    doc,
    className,
}: {
    doc: unknown;
    className?: string;
}) {
    const root = doc as RenderNode | null;
    if (!root?.content?.length) {
        return <div className={className}>{null}</div>;
    }
    return <div className={className}>{renderBlocks(root.content, "n")}</div>;
}
